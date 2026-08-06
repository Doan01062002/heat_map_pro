// Package persistence handles batch writing of deviation events to PostgreSQL.
// It runs a background flush loop that writes accumulated events every 30 seconds
// and exposes REST handlers for historical data queries.
package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/heat-map-pro/backend/internal/aggregator"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DeviationEvent represents a single confirmed deviation to be persisted.
// It is produced by the ingestion handler and buffered here until the next flush.
type DeviationEvent struct {
	DriverID        string
	TripID          string
	Latitude        float64
	Longitude       float64
	H3Index         string
	DeviationMeters float64
	Heading         float32
	SpeedKmh        float32
	Timestamp       time.Time
}

// PostgresWriter handles batch inserts and historical queries.
type PostgresWriter struct {
	pool *pgxpool.Pool

	// Thread-safe event buffer — ingestion handler writes, flush loop reads+clears
	mu     sync.Mutex
	buffer []DeviationEvent
}

// NewPostgresWriter creates a new PostgreSQL writer with connection pooling.
func NewPostgresWriter(ctx context.Context, cfg *config.Config) (*PostgresWriter, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("postgresWriter: parse DSN: %w", err)
	}

	poolCfg.MaxConns = 5
	poolCfg.MinConns = 1

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("postgresWriter: connect: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("postgresWriter: ping: %w", err)
	}

	slog.Info("postgresql connected", "host", cfg.PostgresHost, "db", cfg.PostgresDB)

	return &PostgresWriter{
		pool:   pool,
		buffer: make([]DeviationEvent, 0, 1024),
	}, nil
}

// BufferEvent adds a deviation event to the write buffer.
// This is called by the ingestion handler for each confirmed deviation.
// Thread-safe — multiple goroutines can call this concurrently.
func (w *PostgresWriter) BufferEvent(event DeviationEvent) {
	w.mu.Lock()
	w.buffer = append(w.buffer, event)
	w.mu.Unlock()
}

// StartFlushLoop runs a background loop that writes buffered deviation events
// to PostgreSQL at the given interval (default: 30 seconds).
func (w *PostgresWriter) StartFlushLoop(ctx context.Context, agg *aggregator.Aggregator, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("postgres flush loop started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			// Final flush on shutdown
			w.flush(ctx)
			slog.Info("postgres flush loop stopped")
			return
		case <-ticker.C:
			w.flush(ctx)
		}
	}
}

// flush drains the event buffer and batch-inserts all events into PostgreSQL.
// Uses a single transaction with COPY-like batch insert for performance.
func (w *PostgresWriter) flush(ctx context.Context) {
	// Swap out the buffer atomically
	w.mu.Lock()
	if len(w.buffer) == 0 {
		w.mu.Unlock()
		return
	}
	events := w.buffer
	w.buffer = make([]DeviationEvent, 0, cap(events))
	w.mu.Unlock()

	// Batch insert using a single transaction
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		slog.Error("postgres flush: begin tx failed", "error", err, "events_lost", len(events))
		return
	}

	const insertSQL = `INSERT INTO deviation_events 
		(driver_id, trip_id, latitude, longitude, h3_index, deviation_meters, heading, speed_kmh, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	inserted := 0
	for _, e := range events {
		_, err := tx.Exec(ctx, insertSQL,
			e.DriverID, e.TripID,
			e.Latitude, e.Longitude,
			e.H3Index, e.DeviationMeters,
			e.Heading, e.SpeedKmh,
			e.Timestamp,
		)
		if err != nil {
			slog.Error("postgres flush: insert failed",
				"error", err,
				"driver_id", e.DriverID,
				"h3_index", e.H3Index,
			)
			continue
		}
		inserted++
	}

	if err := tx.Commit(ctx); err != nil {
		slog.Error("postgres flush: commit failed", "error", err, "events_lost", inserted)
		return
	}

	slog.Info("postgres flush: batch inserted",
		"inserted", inserted,
		"total_buffered", len(events),
	)
}

// HandleHistoryQuery handles GET /api/history?from=<unix_ms>&to=<unix_ms>
func (w *PostgresWriter) HandleHistoryQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")

	if fromStr == "" || toStr == "" {
		http.Error(wr, `{"error":"from and to query parameters are required (unix milliseconds)"}`, http.StatusBadRequest)
		return
	}

	fromMS, err := strconv.ParseInt(fromStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'from' parameter"}`, http.StatusBadRequest)
		return
	}

	toMS, err := strconv.ParseInt(toStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'to' parameter"}`, http.StatusBadRequest)
		return
	}

	fromTime := time.UnixMilli(fromMS)
	toTime := time.UnixMilli(toMS)

	rows, err := w.pool.Query(r.Context(),
		`SELECT h3_index, intensity, last_updated, unique_drivers
		 FROM get_heatmap_for_period($1, $2)`,
		fromTime, toTime,
	)
	if err != nil {
		slog.Error("history query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type cellResult struct {
		H3Index       string `json:"h3_index"`
		Intensity     int    `json:"intensity"`
		LastUpdated   int64  `json:"last_updated"`
		UniqueDrivers int    `json:"unique_drivers"`
	}

	var cells []cellResult
	for rows.Next() {
		var c cellResult
		var lastUpdated time.Time
		if err := rows.Scan(&c.H3Index, &c.Intensity, &lastUpdated, &c.UniqueDrivers); err != nil {
			slog.Error("history query: scan failed", "error", err)
			continue
		}
		c.LastUpdated = lastUpdated.UnixMilli()
		cells = append(cells, c)
	}

	if cells == nil {
		cells = []cellResult{} // Return empty array, not null
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"cells": cells,
		"query": map[string]interface{}{
			"from": fromMS,
			"to":   toMS,
		},
		"total_cells": len(cells),
	})
}

// HandleDeviationsQuery handles GET /api/deviations?driver_id=<id>&from=<ms>&to=<ms>&limit=<n>
func (w *PostgresWriter) HandleDeviationsQuery(wr http.ResponseWriter, r *http.Request) {
	driverID := r.URL.Query().Get("driver_id")
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")

	limit := 100
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}

	query := `SELECT id, driver_id, trip_id, latitude, longitude, h3_index, deviation_meters, created_at
	          FROM deviation_events WHERE 1=1`
	args := []interface{}{}
	argIdx := 1

	if driverID != "" {
		query += fmt.Sprintf(" AND driver_id = $%d", argIdx)
		args = append(args, driverID)
		argIdx++
	}

	if fromStr != "" {
		fromMS, _ := strconv.ParseInt(fromStr, 10, 64)
		query += fmt.Sprintf(" AND created_at >= $%d", argIdx)
		args = append(args, time.UnixMilli(fromMS))
		argIdx++
	}

	if toStr != "" {
		toMS, _ := strconv.ParseInt(toStr, 10, 64)
		query += fmt.Sprintf(" AND created_at <= $%d", argIdx)
		args = append(args, time.UnixMilli(toMS))
		argIdx++
	}

	query += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", argIdx)
	args = append(args, limit)

	rows, err := w.pool.Query(r.Context(), query, args...)
	if err != nil {
		slog.Error("deviations query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type eventResult struct {
		ID              int64   `json:"id"`
		DriverID        string  `json:"driver_id"`
		TripID          string  `json:"trip_id"`
		Latitude        float64 `json:"latitude"`
		Longitude       float64 `json:"longitude"`
		H3Index         string  `json:"h3_index"`
		DeviationMeters float64 `json:"deviation_meters"`
		Timestamp       int64   `json:"timestamp"`
	}

	var events []eventResult
	for rows.Next() {
		var e eventResult
		var createdAt time.Time
		if err := rows.Scan(&e.ID, &e.DriverID, &e.TripID, &e.Latitude, &e.Longitude,
			&e.H3Index, &e.DeviationMeters, &createdAt); err != nil {
			slog.Error("deviations query: scan failed", "error", err)
			continue
		}
		e.Timestamp = createdAt.UnixMilli()
		events = append(events, e)
	}

	if events == nil {
		events = []eventResult{}
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"events": events,
		"total":  len(events),
	})
}

// Close closes the PostgreSQL connection pool.
func (w *PostgresWriter) Close() {
	w.pool.Close()
}

// HandlePointsQuery handles GET /api/points?from=<ms>&to=<ms>&limit=<n>
// Returns raw GPS coordinates for heatmap rendering — naturally on roads.
func (w *PostgresWriter) HandlePointsQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")

	if fromStr == "" || toStr == "" {
		http.Error(wr, `{"error":"from and to query parameters are required (unix milliseconds)"}`, http.StatusBadRequest)
		return
	}

	fromMS, err := strconv.ParseInt(fromStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'from' parameter"}`, http.StatusBadRequest)
		return
	}
	toMS, err := strconv.ParseInt(toStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'to' parameter"}`, http.StatusBadRequest)
		return
	}

	limit := 0
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}

	var rows pgx.Rows
	var queryErr error
	if limit > 0 {
		rows, queryErr = w.pool.Query(r.Context(), `
			SELECT latitude, longitude, deviation_meters
			FROM deviation_events
			WHERE created_at >= $1 AND created_at <= $2
			ORDER BY deviation_meters DESC
			LIMIT $3
		`, time.UnixMilli(fromMS), time.UnixMilli(toMS), limit)
	} else {
		rows, queryErr = w.pool.Query(r.Context(), `
			SELECT latitude, longitude, deviation_meters
			FROM deviation_events
			WHERE created_at >= $1 AND created_at <= $2
			ORDER BY deviation_meters DESC
		`, time.UnixMilli(fromMS), time.UnixMilli(toMS))
	}
	if queryErr != nil {
		slog.Error("points query failed", "error", queryErr)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type point struct {
		Lat       float64 `json:"lat"`
		Lng       float64 `json:"lng"`
		Deviation float64 `json:"deviation"`
	}

	points := make([]point, 0, 1024)
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.Lat, &p.Lng, &p.Deviation); err != nil {
			continue
		}
		points = append(points, p)
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"points":      points,
		"total":       len(points),
		"from":        fromMS,
		"to":          toMS,
	})
}

// HandleTrajectoriesQuery handles GET /api/trajectories?from=<ms>&to=<ms>&limit=<n>
// Returns per-trip GPS paths as GeoJSON LineString features.
func (w *PostgresWriter) HandleTrajectoriesQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")

	if fromStr == "" || toStr == "" {
		http.Error(wr, `{"error":"from and to query parameters are required (unix milliseconds)"}`, http.StatusBadRequest)
		return
	}

	fromMS, err := strconv.ParseInt(fromStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'from' parameter"}`, http.StatusBadRequest)
		return
	}
	toMS, err := strconv.ParseInt(toStr, 10, 64)
	if err != nil {
		http.Error(wr, `{"error":"invalid 'to' parameter"}`, http.StatusBadRequest)
		return
	}

	limit := 0
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}

	// Fetch top N trips by point count, ordered by time
	if limit > 0 {
		rows, err := w.pool.Query(r.Context(), `
			SELECT trip_id, driver_id,
			       array_agg(longitude ORDER BY created_at) AS lngs,
			       array_agg(latitude  ORDER BY created_at) AS lats,
			       AVG(deviation_meters)::FLOAT8            AS avg_deviation,
			       COUNT(*)::INT                            AS point_count
			FROM deviation_events
			WHERE created_at >= $1 AND created_at <= $2
			GROUP BY trip_id, driver_id
			HAVING COUNT(*) >= 3
			ORDER BY COUNT(*) DESC
			LIMIT $3
		`, time.UnixMilli(fromMS), time.UnixMilli(toMS), limit)
		if err != nil {
			slog.Error("trajectories query failed", "error", err)
			http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		w.renderTrajectoriesJSON(wr, rows, fromMS, toMS)
	} else {
		rows, err := w.pool.Query(r.Context(), `
			SELECT trip_id, driver_id,
			       array_agg(longitude ORDER BY created_at) AS lngs,
			       array_agg(latitude  ORDER BY created_at) AS lats,
			       AVG(deviation_meters)::FLOAT8            AS avg_deviation,
			       COUNT(*)::INT                            AS point_count
			FROM deviation_events
			WHERE created_at >= $1 AND created_at <= $2
			GROUP BY trip_id, driver_id
			HAVING COUNT(*) >= 3
			ORDER BY COUNT(*) DESC
		`, time.UnixMilli(fromMS), time.UnixMilli(toMS))
		if err != nil {
			slog.Error("trajectories query failed", "error", err)
			http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		w.renderTrajectoriesJSON(wr, rows, fromMS, toMS)
	}
}

func (w *PostgresWriter) renderTrajectoriesJSON(wr http.ResponseWriter, rows pgx.Rows, fromMS, toMS int64) {
	type Feature struct {
		Type     string                 `json:"type"`
		Geometry map[string]interface{} `json:"geometry"`
		Props    map[string]interface{} `json:"properties"`
	}

	features := make([]Feature, 0, 256)
	for rows.Next() {
		var tripID, driverID string
		var lngs, lats []float64
		var avgDev float64
		var ptCount int

		if err := rows.Scan(&tripID, &driverID, &lngs, &lats, &avgDev, &ptCount); err != nil {
			continue
		}
		if len(lngs) != len(lats) || len(lngs) < 2 {
			continue
		}

		coords := make([][2]float64, len(lngs))
		for i := range lngs {
			coords[i] = [2]float64{lngs[i], lats[i]}
		}

		features = append(features, Feature{
			Type: "Feature",
			Geometry: map[string]interface{}{
				"type":        "LineString",
				"coordinates": coords,
			},
			Props: map[string]interface{}{
				"trip_id":      tripID,
				"driver_id":    driverID,
				"avg_deviation": avgDev,
				"point_count":  ptCount,
			},
		})
	}

	geojson := map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"geojson": geojson,
		"total":   len(features),
		"from":    fromMS,
		"to":      toMS,
	})
}

// HandleRoadStatsQuery returns aggregated statistics for GPS events near a map click point.
// Query params: lat, lng (required), radius (meters, default 120, max 400).
// Used for the "click on road segment → show Vietnamese stats popup" feature.
func (w *PostgresWriter) HandleRoadStatsQuery(wr http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		wr.WriteHeader(http.StatusOK)
		return
	}

	latStr := r.URL.Query().Get("lat")
	lngStr := r.URL.Query().Get("lng")
	radiusStr := r.URL.Query().Get("radius")

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		http.Error(wr, "invalid lat", http.StatusBadRequest)
		return
	}
	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		http.Error(wr, "invalid lng", http.StatusBadRequest)
		return
	}
	radius := 120.0
	if radiusStr != "" {
		if v, err := strconv.ParseFloat(radiusStr, 64); err == nil && v > 0 && v <= 400 {
			radius = v
		}
	}

	// Haversine distance in metres (pure SQL, no PostGIS required)
	const query = `
		SELECT
			COUNT(*)                                                               AS total_events,
			COUNT(DISTINCT trip_id)                                                AS unique_trips,
			COUNT(DISTINCT driver_id)                                              AS unique_drivers,
			COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS avg_deviation,
			COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS max_deviation,
			COUNT(CASE WHEN deviation_meters > 50  THEN 1 END)                    AS high_dev_events,
			COUNT(DISTINCT CASE WHEN deviation_meters > 50  THEN trip_id END)     AS high_dev_trips
		FROM deviation_events
		WHERE (
			6371000.0 * acos(GREATEST(-1.0, LEAST(1.0,
				cos(radians($1)) * cos(radians(latitude))  *
				cos(radians(longitude) - radians($2)) +
				sin(radians($1)) * sin(radians(latitude))
			)))
		) <= $3
	`

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	row := w.pool.QueryRow(ctx, query, lat, lng, radius)

	var (
		totalEvents   int64
		uniqueTrips   int64
		uniqueDrivers int64
		avgDeviation  float64
		maxDeviation  float64
		highDevEvents int64
		highDevTrips  int64
	)

	if err := row.Scan(&totalEvents, &uniqueTrips, &uniqueDrivers,
		&avgDeviation, &maxDeviation, &highDevEvents, &highDevTrips); err != nil {
		slog.Error("road-stats query failed", "err", err)
		http.Error(wr, "query error", http.StatusInternalServerError)
		return
	}

	normalTrips := uniqueTrips - highDevTrips
	var avoidRatio float64
	if uniqueTrips > 0 {
		avoidRatio = float64(highDevTrips) / float64(uniqueTrips) * 100
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"lat":            lat,
		"lng":            lng,
		"radius_m":       radius,
		"total_events":   totalEvents,
		"unique_trips":   uniqueTrips,
		"unique_drivers": uniqueDrivers,
		"avg_deviation":  avgDeviation,
		"max_deviation":  maxDeviation,
		"high_dev_events": highDevEvents,
		"high_dev_trips":  highDevTrips,
		"normal_trips":   normalTrips,
		"avoid_ratio":    avoidRatio,
	})
}
