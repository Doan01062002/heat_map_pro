// Package persistence handles batch writing of deviation events to PostgreSQL.
// It runs a background flush loop that writes accumulated events every 30 seconds
// and exposes REST handlers for historical data queries.
package persistence

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/heat-map-pro/backend/internal/aggregator"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/heat-map-pro/backend/internal/spatial"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DeviationEvent represents a single confirmed GPS event to be persisted.
// EventType distinguishes:
//   - "deviation"    — GPS point > 50m from planned OSRM route (driver is off-route)
//   - "actual_path"  — GPS point of the road the driver actually chose instead of
//                      the OSRM suggestion (i.e. the detour path itself)
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
	EventType       string // "deviation" | "actual_path" — defaults to "deviation"
}

// PostgresWriter handles batch inserts and historical queries.
type PostgresWriter struct {
	pool *pgxpool.Pool

	// Thread-safe event buffer — ingestion handler writes, flush loop reads+clears
	mu          sync.Mutex
	buffer      []DeviationEvent
	onTripSaved func(trip TripPayload)
}

func (w *PostgresWriter) SetOnTripSaved(fn func(trip TripPayload)) {
	w.onTripSaved = fn
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

// Pool returns the underlying pgxpool connection pool.
func (w *PostgresWriter) Pool() *pgxpool.Pool {
	return w.pool
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
		(driver_id, trip_id, latitude, longitude, h3_index, deviation_meters, heading, speed_kmh, created_at, event_type)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`

	inserted := 0
	for _, e := range events {
		eventType := e.EventType
		if eventType == "" {
			eventType = "deviation"
		}
		_, err := tx.Exec(ctx, insertSQL,
			e.DriverID, e.TripID,
			e.Latitude, e.Longitude,
			e.H3Index, e.DeviationMeters,
			e.Heading, e.SpeedKmh,
			e.Timestamp,
			eventType,
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

// HandleHistoryQuery handles GET /api/history?from=<unix_ms>&to=<unix_ms>&driver_id=<id>
func (w *PostgresWriter) HandleHistoryQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime := time.Now().Add(24 * time.Hour)

	if fromStr != "" {
		if fromMS, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(fromMS)
		}
	}
	if toStr != "" {
		if toMS, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(toMS)
		}
	}

	var rows pgx.Rows
	var err error

	if driverID != "" {
		query := `
			SELECT
				h3_index,
				COUNT(*)::INTEGER AS intensity,
				MAX(created_at) AS last_updated,
				1 AS unique_drivers
			FROM deviation_events
			WHERE created_at >= $1 AND created_at <= $2 AND driver_id = $3
			GROUP BY h3_index
			ORDER BY intensity DESC
		`
		rows, err = w.pool.Query(r.Context(), query, fromTime, toTime, driverID)
	} else {
		rows, err = w.pool.Query(r.Context(),
			`SELECT h3_index, intensity, last_updated, unique_drivers
			 FROM get_heatmap_for_period($1, $2)`,
			fromTime, toTime,
		)
	}
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
			"from": fromTime.UnixMilli(),
			"to":   toTime.UnixMilli(),
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

// HandlePointsQuery handles GET /api/points?from=<ms>&to=<ms>&limit=<n>&driver_id=<id>
// Supports optional viewport bbox: min_lat, max_lat, min_lng, max_lng.
// When bbox is provided, ALL points in that area are returned (no 50k cap) — the
// viewport is geographically small so row count is safe.
// Without bbox: returns the top 50,000 highest-deviation points across the full range.
func (w *PostgresWriter) HandlePointsQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime := time.Now().Add(24 * time.Hour)

	if fromStr != "" {
		if fromMS, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(fromMS)
		}
	}
	if toStr != "" {
		if toMS, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(toMS)
		}
	}

	// ── Viewport bbox (optional) ───────────────────────────────────────────────
	// When all four bbox params are provided we run a geographically-bounded query.
	// This is used by the frontend at zoom res ≥ 11 to get ALL points in the
	// visible area, not just the global top-50k sample.
	minLatStr := r.URL.Query().Get("min_lat")
	maxLatStr := r.URL.Query().Get("max_lat")
	minLngStr := r.URL.Query().Get("min_lng")
	maxLngStr := r.URL.Query().Get("max_lng")

	hasBBox := minLatStr != "" && maxLatStr != "" && minLngStr != "" && maxLngStr != ""

	var minLat, maxLat, minLng, maxLng float64
	if hasBBox {
		minLat, _ = strconv.ParseFloat(minLatStr, 64)
		maxLat, _ = strconv.ParseFloat(maxLatStr, 64)
		minLng, _ = strconv.ParseFloat(minLngStr, 64)
		maxLng, _ = strconv.ParseFloat(maxLngStr, 64)
	}

	// Default: 100,000 highest-deviation points (~26% of 386k Porto dataset).
	// Benchmark: ~8s / 12MB. At this size, H3 cell coverage is >99% of the full
	// dataset because high-deviation points cluster in the same geographic cells.
	// Hard cap: 500,000 — caller must explicitly opt-in to the full payload.
	const defaultLimit = 100_000
	const hardCapLimit = 500_000
	limit := defaultLimit
	if hasBBox {
		// Viewport fetch: no cap — the bbox guarantees a manageable row count.
		limit = 0
	} else if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
			if limit > hardCapLimit {
				limit = hardCapLimit
			}
		}
	}

	var rows pgx.Rows
	var queryErr error

	query := `SELECT latitude, longitude, deviation_meters, trip_id, driver_id FROM deviation_events WHERE created_at >= $1 AND created_at <= $2`
	args := []interface{}{fromTime, toTime}
	argIdx := 3

	if driverID != "" {
		query += fmt.Sprintf(" AND driver_id = $%d", argIdx)
		args = append(args, driverID)
		argIdx++
	}

	if hasBBox {
		// Tight bounding-box filter: uses btree index on (latitude, longitude)
		query += fmt.Sprintf(" AND latitude BETWEEN $%d AND $%d AND longitude BETWEEN $%d AND $%d",
			argIdx, argIdx+1, argIdx+2, argIdx+3)
		args = append(args, minLat, maxLat, minLng, maxLng)
		argIdx += 4
		query += " ORDER BY deviation_meters DESC" // no LIMIT for bbox
	} else {
		// Offset-based pagination: caller sends ?limit=N&offset=M to page through all data.
		// offset=0 means first chunk, offset=50000 means second chunk, etc.
		offsetStr := r.URL.Query().Get("offset")
		offset := 0
		if offsetStr != "" {
			if n, err := strconv.Atoi(offsetStr); err == nil && n >= 0 {
				offset = n
			}
		}
		if limit > 0 {
			query += fmt.Sprintf(" ORDER BY deviation_meters DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
			args = append(args, limit, offset)
		} else {
			query += " ORDER BY deviation_meters DESC"
		}
	}

	rows, queryErr = w.pool.Query(r.Context(), query, args...)
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
		TripID    string  `json:"trip_id"`
		DriverID  string  `json:"driver_id"`
	}

	points := make([]point, 0, limit)
	for rows.Next() {
		var p point
		if err := rows.Scan(&p.Lat, &p.Lng, &p.Deviation, &p.TripID, &p.DriverID); err != nil {
			continue
		}
		points = append(points, p)
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"points":      points,
		"total":       len(points),
		"from":        fromTime.UnixMilli(),
		"to":          toTime.UnixMilli(),
	})
}

// HandleTrajectoriesQuery handles GET /api/trajectories?from=<ms>&to=<ms>&limit=<n>&driver_id=<id>
// Returns per-trip GPS paths as GeoJSON LineString features.
func (w *PostgresWriter) HandleTrajectoriesQuery(wr http.ResponseWriter, r *http.Request) {
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	limitStr := r.URL.Query().Get("limit")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime := time.Now().Add(24 * time.Hour)

	if fromStr != "" {
		if fromMS, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(fromMS)
		}
	}
	if toStr != "" {
		if toMS, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(toMS)
		}
	}

	// Default: 500 trips. Hard cap: 1000.
	const defaultTrajLimit = 500
	const hardCapTrajLimit = 1000
	limit := defaultTrajLimit
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
			if limit > hardCapTrajLimit {
				limit = hardCapTrajLimit
			}
		}
	}

	query := `
		SELECT trip_id, driver_id,
			array_agg(longitude ORDER BY created_at) AS lngs,
			array_agg(latitude  ORDER BY created_at) AS lats,
			AVG(deviation_meters)::FLOAT8            AS avg_deviation,
			COUNT(*)::INT                            AS point_count
		FROM deviation_events
		WHERE created_at >= $1 AND created_at <= $2
	`
	args := []interface{}{fromTime, toTime}
	argIdx := 3

	if driverID != "" {
		query += fmt.Sprintf(" AND driver_id = $%d", argIdx)
		args = append(args, driverID)
		argIdx++
	}

	query += `
		GROUP BY trip_id, driver_id
		HAVING COUNT(*) >= 3
		ORDER BY COUNT(*) DESC
		LIMIT $` + fmt.Sprintf("%d", argIdx)
	args = append(args, limit)

	rows, err := w.pool.Query(r.Context(), query, args...)
	if err != nil {
		slog.Error("trajectories query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	w.renderTrajectoriesJSON(wr, rows, fromTime.UnixMilli(), toTime.UnixMilli())
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
// Supports Bounding Box (min_lat/max_lat/min_lng/max_lng) for exact H3 Hexagon polygons
// or PostGIS ST_DWithin for fast radial queries (replaces Haversine full-scan).
func (w *PostgresWriter) HandleRoadStatsQuery(wr http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		wr.WriteHeader(http.StatusOK)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	minLatStr := r.URL.Query().Get("min_lat")
	maxLatStr := r.URL.Query().Get("max_lat")
	minLngStr := r.URL.Query().Get("min_lng")
	maxLngStr := r.URL.Query().Get("max_lng")

	var row pgx.Row
	var queryLat, queryLng float64

	if minLatStr != "" && maxLatStr != "" && minLngStr != "" && maxLngStr != "" {
		minLat, _ := strconv.ParseFloat(minLatStr, 64)
		maxLat, _ := strconv.ParseFloat(maxLatStr, 64)
		minLng, _ := strconv.ParseFloat(minLngStr, 64)
		maxLng, _ := strconv.ParseFloat(maxLngStr, 64)

		queryLat = (minLat + maxLat) / 2.0
		queryLng = (minLng + maxLng) / 2.0

		// Bounding-box match — event_type='deviation' only for road-stats (deviation perspective)
		const bboxQuery = `
			SELECT
				COUNT(*)                                                               AS total_events,
				COUNT(DISTINCT trip_id)                                                AS unique_trips,
				COUNT(DISTINCT driver_id)                                              AS unique_drivers,
				COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS avg_deviation,
				COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS max_deviation,
				COUNT(CASE WHEN deviation_meters > 150 THEN 1 END)                    AS high_dev_events,
				COUNT(DISTINCT CASE WHEN deviation_meters > 150 THEN trip_id END)     AS high_dev_trips,
				COUNT(DISTINCT CASE WHEN deviation_meters <= 150 THEN trip_id END)    AS normal_trips
			FROM deviation_events
			WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
			  AND event_type = 'deviation'
		`
		row = w.pool.QueryRow(ctx, bboxQuery, minLat, maxLat, minLng, maxLng)
	} else {
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
		queryLat = lat
		queryLng = lng

		radius := 120.0
		if radiusStr != "" {
			if v, err := strconv.ParseFloat(radiusStr, 64); err == nil && v > 0 && v <= 400 {
				radius = v
			}
		}

		// PostGIS ST_DWithin — uses GIST index on geog column (O(log n) vs O(n) Haversine)
		const query = `
			SELECT
				COUNT(*)                                                               AS total_events,
				COUNT(DISTINCT trip_id)                                                AS unique_trips,
				COUNT(DISTINCT driver_id)                                              AS unique_drivers,
				COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS avg_deviation,
				COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8         AS max_deviation,
				COUNT(CASE WHEN deviation_meters > 150 THEN 1 END)                    AS high_dev_events,
				COUNT(DISTINCT CASE WHEN deviation_meters > 150 THEN trip_id END)     AS high_dev_trips,
				COUNT(DISTINCT CASE WHEN deviation_meters <= 150 THEN trip_id END)    AS normal_trips
			FROM deviation_events
			WHERE ST_DWithin(
				geog,
				ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
				$3
			)
			  AND event_type = 'deviation'
		`
		row = w.pool.QueryRow(ctx, query, lat, lng, radius)
	}

	var (
		totalEvents   int64
		uniqueTrips   int64
		uniqueDrivers int64
		avgDeviation  float64
		maxDeviation  float64
		highDevEvents int64
		highDevTrips  int64
		normalTrips   int64
	)

	if err := row.Scan(&totalEvents, &uniqueTrips, &uniqueDrivers,
		&avgDeviation, &maxDeviation, &highDevEvents, &highDevTrips, &normalTrips); err != nil {
		slog.Error("road-stats query failed", "err", err)
		http.Error(wr, "query error", http.StatusInternalServerError)
		return
	}

	var avoidRatio float64
	if uniqueTrips > 0 {
		avoidRatio = float64(highDevTrips) / float64(uniqueTrips) * 100
		avoidRatio = float64(int(avoidRatio*10)) / 10.0
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"lat":            queryLat,
		"lng":            queryLng,
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

// TripPayload defines the JSON structure for saving/retrieving trips.
type TripPayload struct {
	TripID            string          `json:"trip_id"`
	DriverID          string          `json:"driver_id"`
	DriverName        string          `json:"driver_name,omitempty"`
	OriginJSON        json.RawMessage `json:"origin"`
	DestinationJSON   json.RawMessage `json:"destination"`
	WaypointsJSON     json.RawMessage `json:"waypoints"`
	ActualRouteJSON   json.RawMessage `json:"actual_route"`
	PlannedRouteJSON  json.RawMessage `json:"planned_route,omitempty"`  // OSRM suggested polyline [[lng,lat],...]
	DistanceKm        float64         `json:"distance_km"`
	DurationMin       int             `json:"duration_min"`
	IsDeviated        bool            `json:"is_deviated"`
	DeviationRatio    float64         `json:"deviation_ratio,omitempty"` // 0.0–1.0: fraction of actual route off planned
	Status            string          `json:"status"`
	CreatedAt         int64           `json:"created_at"`
}

// HandleSaveTrip handles POST /api/trips to save a trip with rich metadata.
func (w *PostgresWriter) HandleSaveTrip(wr http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		wr.WriteHeader(http.StatusOK)
		return
	}

	var req TripPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(wr, fmt.Sprintf(`{"error":"invalid body: %s"}`, err), http.StatusBadRequest)
		return
	}

	if req.TripID == "" || req.DriverID == "" {
		http.Error(wr, `{"error":"trip_id and driver_id are required"}`, http.StatusBadRequest)
		return
	}

	if len(req.OriginJSON) == 0 {
		req.OriginJSON = json.RawMessage("{}")
	}
	if len(req.DestinationJSON) == 0 {
		req.DestinationJSON = json.RawMessage("{}")
	}
	if len(req.WaypointsJSON) == 0 {
		req.WaypointsJSON = json.RawMessage("[]")
	}
	if len(req.ActualRouteJSON) == 0 {
		req.ActualRouteJSON = json.RawMessage("[]")
	}
	if len(req.PlannedRouteJSON) == 0 {
		req.PlannedRouteJSON = json.RawMessage("[]")
	}
	if req.Status == "" {
		req.Status = "completed"
	}

	// Fetch driver full_name if not provided
	if req.DriverName == "" {
		_ = w.pool.QueryRow(r.Context(), "SELECT full_name FROM drivers WHERE driver_id = $1", req.DriverID).Scan(&req.DriverName)
		if req.DriverName == "" {
			req.DriverName = req.DriverID
		}
	}

	// ── Compute deviation_ratio: fraction of actual route > 50m from planned ─
	var actualCoords [][2]float64
	var plannedCoords [][2]float64
	_ = json.Unmarshal(req.ActualRouteJSON, &actualCoords)
	_ = json.Unmarshal(req.PlannedRouteJSON, &plannedCoords)

	deviationRatio := 0.0
	if len(plannedCoords) > 0 && len(actualCoords) > 0 {
		offRouteCount := 0
		for _, ap := range actualCoords {
			minDist := math.MaxFloat64
			for j := 0; j < len(plannedCoords)-1; j++ {
				d := pointSegDistM(ap, plannedCoords[j], plannedCoords[j+1])
				if d < minDist {
					minDist = d
				}
			}
			if minDist > 50.0 {
				offRouteCount++
			}
		}
		deviationRatio = float64(offRouteCount) / float64(len(actualCoords))
	}
	req.DeviationRatio = math.Round(deviationRatio*1000) / 1000 // 3 decimal places

	query := `
		INSERT INTO trips (
			trip_id, driver_id, origin_json, destination_json,
			waypoints_json, actual_route_json, planned_route_json,
			distance_km, duration_min, is_deviated, deviation_ratio, status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
		ON CONFLICT (trip_id) DO UPDATE SET
			origin_json = EXCLUDED.origin_json,
			destination_json = EXCLUDED.destination_json,
			waypoints_json = EXCLUDED.waypoints_json,
			actual_route_json = EXCLUDED.actual_route_json,
			planned_route_json = EXCLUDED.planned_route_json,
			distance_km = EXCLUDED.distance_km,
			duration_min = EXCLUDED.duration_min,
			is_deviated = EXCLUDED.is_deviated,
			deviation_ratio = EXCLUDED.deviation_ratio,
			status = EXCLUDED.status;
	`

	_, err := w.pool.Exec(r.Context(), query,
		req.TripID, req.DriverID, req.OriginJSON, req.DestinationJSON,
		req.WaypointsJSON, req.ActualRouteJSON, req.PlannedRouteJSON,
		req.DistanceKm, req.DurationMin, req.IsDeviated, req.DeviationRatio, req.Status,
	)

	if err != nil {
		slog.Error("failed to save trip", "error", err)
		http.Error(wr, `{"error":"failed to save trip"}`, http.StatusInternalServerError)
		return
	}

	// ── Insert actual_path events (the road the driver actually chose) ────────
	// Each point from the actual GPS route is tagged event_type='actual_path'.
	// These feed the "Hex Tài Xế Đi" layer in the admin dashboard.
	if len(actualCoords) > 0 {
		indexer := spatial.NewH3Indexer(8)
		now := time.Now()

		const insertActual = `
			INSERT INTO deviation_events (
				driver_id, trip_id, latitude, longitude, h3_index,
				deviation_meters, heading, speed_kmh, created_at, event_type
			) VALUES ($1, $2, $3, $4, $5, $6, 90, 40, $7, 'actual_path')
			ON CONFLICT DO NOTHING`

		for idx, pt := range actualCoords {
			lng, lat := pt[0], pt[1]
			h3Index := indexer.LatLngToCell(lat, lng)

			// Compute distance from this actual point to nearest planned segment (meters)
			devMeters := 0.0
			if len(plannedCoords) > 1 {
				minD := math.MaxFloat64
				for j := 0; j < len(plannedCoords)-1; j++ {
					d := pointSegDistM(pt, plannedCoords[j], plannedCoords[j+1])
					if d < minD {
						minD = d
					}
				}
				devMeters = minD
			}

			ptTime := now.Add(time.Duration(idx) * time.Second)
			_, errInst := w.pool.Exec(r.Context(), insertActual,
				req.DriverID, req.TripID, lat, lng, h3Index, devMeters, ptTime)
			if errInst != nil {
				slog.Warn("failed to insert actual_path event", "error", errInst, "trip_id", req.TripID)
			}
		}
		slog.Info("inserted actual_path points", "trip_id", req.TripID, "points", len(actualCoords))
	}

	// Fetch created_at timestamp
	var createdAt time.Time
	_ = w.pool.QueryRow(r.Context(), "SELECT created_at FROM trips WHERE trip_id = $1", req.TripID).Scan(&createdAt)
	req.CreatedAt = createdAt.UnixMilli()

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"status": "saved",
		"trip":   req,
	})

	if w.onTripSaved != nil {
		w.onTripSaved(req)
	}

	slog.Info("trip saved to database", "trip_id", req.TripID, "driver_id", req.DriverID)
}

// HandleGetTrips handles GET /api/trips?driver_id=<id>&limit=<n>
func (w *PostgresWriter) HandleGetTrips(wr http.ResponseWriter, r *http.Request) {
	driverID := r.URL.Query().Get("driver_id")
	limitStr := r.URL.Query().Get("limit")

	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}

	var rows pgx.Rows
	var queryErr error

	if driverID != "" {
		rows, queryErr = w.pool.Query(r.Context(), `
			SELECT t.trip_id, t.driver_id, COALESCE(d.full_name, t.driver_id) AS driver_name,
			       t.origin_json, t.destination_json, t.waypoints_json, t.actual_route_json,
			       t.distance_km, t.duration_min, t.is_deviated, t.status, t.created_at
			FROM trips t
			LEFT JOIN drivers d ON t.driver_id = d.driver_id
			WHERE t.driver_id = $1
			ORDER BY t.created_at DESC
			LIMIT $2
		`, driverID, limit)
	} else {
		rows, queryErr = w.pool.Query(r.Context(), `
			SELECT t.trip_id, t.driver_id, COALESCE(d.full_name, t.driver_id) AS driver_name,
			       t.origin_json, t.destination_json, t.waypoints_json, t.actual_route_json,
			       t.distance_km, t.duration_min, t.is_deviated, t.status, t.created_at
			FROM trips t
			LEFT JOIN drivers d ON t.driver_id = d.driver_id
			ORDER BY t.created_at DESC
			LIMIT $1
		`, limit)
	}

	if queryErr != nil {
		slog.Error("get trips query failed", "error", queryErr)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	trips := make([]TripPayload, 0, 32)
	for rows.Next() {
		var t TripPayload
		var createdAt time.Time

		err := rows.Scan(
			&t.TripID, &t.DriverID, &t.DriverName,
			&t.OriginJSON, &t.DestinationJSON, &t.WaypointsJSON, &t.ActualRouteJSON,
			&t.DistanceKm, &t.DurationMin, &t.IsDeviated, &t.Status, &createdAt,
		)
		if err != nil {
			slog.Error("scan trip failed", "error", err)
			continue
		}
		t.CreatedAt = createdAt.UnixMilli()
		trips = append(trips, t)
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"trips": trips,
		"total": len(trips),
	})
}

// HourlyStat represents aggregated avoidance statistics for a single hour of the day (0-23).
type HourlyStat struct {
	Hour         int     `json:"hour"`
	TotalPoints  int64   `json:"total_points"`
	TotalTrips   int64   `json:"total_trips"`
	HighDevTrips int64   `json:"high_dev_trips"`
	AvoidRatio   float64 `json:"avoid_ratio"`
	AvgDeviation float64 `json:"avg_deviation"`
	MaxDeviation float64 `json:"max_deviation"`
}

// HandleHourlyStatsQuery handles GET /api/hourly-stats
// Returns aggregated avoidance and trip stats grouped by hour of day (0 to 23).
func (w *PostgresWriter) HandleHourlyStatsQuery(wr http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		wr.WriteHeader(http.StatusOK)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	const query = `
		SELECT
			EXTRACT(HOUR FROM created_at)::INT AS hr,
			COUNT(*)                                                           AS total_points,
			COUNT(DISTINCT trip_id)                                            AS total_trips,
			COUNT(DISTINCT CASE WHEN deviation_meters > 50 THEN trip_id END)  AS high_dev_trips,
			COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8      AS avg_deviation,
			COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8      AS max_deviation
		FROM deviation_events
		GROUP BY EXTRACT(HOUR FROM created_at)
		ORDER BY hr ASC
	`

	rows, err := w.pool.Query(ctx, query)
	if err != nil {
		slog.Error("hourly-stats query failed", "err", err)
		http.Error(wr, `{"error":"query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	hourlyMap := make(map[int]HourlyStat)
	for h := 0; h < 24; h++ {
		hourlyMap[h] = HourlyStat{Hour: h}
	}

	var grandTotalPoints int64 = 0

	for rows.Next() {
		var hr int
		var pts, trips, highDev int64
		var avgDev, maxDev float64
		if err := rows.Scan(&hr, &pts, &trips, &highDev, &avgDev, &maxDev); err == nil {
			grandTotalPoints += pts
			ratio := 0.0
			if trips > 0 {
				ratio = float64(highDev) * 100.0 / float64(trips)
			}
			hourlyMap[hr] = HourlyStat{
				Hour:         hr,
				TotalPoints:  pts,
				TotalTrips:   trips,
				HighDevTrips: highDev,
				AvoidRatio:   float64(int(ratio*10)) / 10.0,
				AvgDeviation: avgDev,
				MaxDeviation: maxDev,
			}
		}
	}

	statsList := make([]HourlyStat, 24)
	for h := 0; h < 24; h++ {
		statsList[h] = hourlyMap[h]
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"hourly_stats": statsList,
		"grand_total":  grandTotalPoints,
	})
}

// ── Geometry helper ────────────────────────────────────────────────────────────

// pointSegDistM returns the approximate distance in metres from point p to the
// line segment a→b, using a flat-earth approximation suitable for short segments
// (< a few km). Coordinates are [lng, lat] in degrees.
func pointSegDistM(p, a, b [2]float64) float64 {
	// Convert degrees to rough metres using equatorial approximation
	const degToM = 111_320.0 // metres per degree of latitude
	px := (p[0] - a[0]) * degToM * math.Cos(a[1]*math.Pi/180)
	py := (p[1] - a[1]) * degToM
	dx := (b[0] - a[0]) * degToM * math.Cos(a[1]*math.Pi/180)
	dy := (b[1] - a[1]) * degToM

	segLen2 := dx*dx + dy*dy
	if segLen2 == 0 {
		return math.Sqrt(px*px + py*py)
	}
	t := math.Max(0, math.Min(1, (px*dx+py*dy)/segLen2))
	ex := px - t*dx
	ey := py - t*dy
	return math.Sqrt(ex*ex + ey*ey)
}

// ── HandleActualPathQuery ──────────────────────────────────────────────────────

// HandleActualPathQuery handles GET /api/actual-path?from=<unix_ms>&to=<unix_ms>&driver_id=<id>
// Returns H3 cell aggregates of deviation events — the road segments drivers actually
// travelled when they went off the OSRM planned route. Powers the "Hex Tài Xế Đi"
// layer in the admin dashboard, useful for identifying alternative routes and
// improving future route planning.
func (w *PostgresWriter) HandleActualPathQuery(wr http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		wr.WriteHeader(http.StatusOK)
		return
	}

	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime := time.Now().Add(24 * time.Hour)

	if fromStr != "" {
		if fromMS, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(fromMS)
		}
	}
	if toStr != "" {
		if toMS, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(toMS)
		}
	}

	var (
		rows     pgx.Rows
		queryErr error
	)

	if driverID != "" {
		queryErr = func() error {
			var err error
			rows, err = w.pool.Query(r.Context(), `
				SELECT
					h3_index,
					intensity,
					last_updated,
					1              AS unique_drivers,
					unique_trips
				FROM mv_deviation_h3_by_driver
				WHERE driver_id = $3
				  AND last_updated >= $1 AND first_seen <= $2
				ORDER BY intensity DESC
			`, fromTime, toTime, driverID)
			return err
		}()
	} else {
		queryErr = func() error {
			var err error
			rows, err = w.pool.Query(r.Context(), `
				SELECT
					h3_index,
					intensity,
					last_updated,
					unique_drivers,
					unique_trips
				FROM mv_deviation_h3_cells
				WHERE last_updated >= $1 AND first_seen <= $2
				ORDER BY intensity DESC
			`, fromTime, toTime)
			return err
		}()
	}

	if queryErr != nil {
		slog.Error("actual-path query failed", "error", queryErr)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type cellResult struct {
		H3Index       string `json:"h3_index"`
		Intensity     int    `json:"intensity"`
		LastUpdated   int64  `json:"last_updated"`
		UniqueDrivers int    `json:"unique_drivers"`
		UniqueTrips   int    `json:"unique_trips"`
	}

	var cells []cellResult
	for rows.Next() {
		var c cellResult
		var lastUpdated time.Time
		if err := rows.Scan(&c.H3Index, &c.Intensity, &lastUpdated, &c.UniqueDrivers, &c.UniqueTrips); err != nil {
			slog.Error("actual-path scan failed", "error", err)
			continue
		}
		c.LastUpdated = lastUpdated.UnixMilli()
		cells = append(cells, c)
	}

	if cells == nil {
		cells = []cellResult{}
	}

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"cells":       cells,
		"total_cells": len(cells),
		"query": map[string]interface{}{
			"from":      fromTime.UnixMilli(),
			"to":        toTime.UnixMilli(),
			"driver_id": driverID,
			"type":      "deviation",
		},
	})
}

// HandleTripsSummaryQuery handles GET /api/trips-summary
// Aggregates trip metadata directly from deviation_events (NOT the trips table).
// The trips table only holds simulator-registered trips (may be very few).
// deviation_events contains the full Porto dataset: ~9,944 unique trip_ids.
//
// Query params:
//   from=<unix_ms>   time range start (default: epoch)
//   to=<unix_ms>     time range end   (default: now+24h)
//   driver_id=<id>   filter by driver (optional)
//   page=<n>         1-based page number (default: 1)
//   page_size=<n>    rows per page, max 500 (default: 200)
func (w *PostgresWriter) HandleTripsSummaryQuery(wr http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	fromStr   := r.URL.Query().Get("from")
	toStr     := r.URL.Query().Get("to")
	driverID  := r.URL.Query().Get("driver_id")
	pageStr   := r.URL.Query().Get("page")
	pageSzStr := r.URL.Query().Get("page_size")

	fromTime := time.Unix(0, 0)
	toTime   := time.Now().Add(24 * time.Hour)
	if fromStr != "" {
		if ms, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(ms)
		}
	}
	if toStr != "" {
		if ms, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(ms)
		}
	}

	page   := 1
	pgSize := 200
	if pageStr != "" {
		if n, err := strconv.Atoi(pageStr); err == nil && n > 0 {
			page = n
		}
	}
	if pageSzStr != "" {
		if n, err := strconv.Atoi(pageSzStr); err == nil && n > 0 && n <= 500 {
			pgSize = n
		}
	}
	offset := (page - 1) * pgSize

	// ── Build WHERE clause against the materialized view ─────────────────────
	// mv_trip_summary is pre-computed at startup and holds one row per trip.
	// Querying it is O(9,944) instead of O(386,328) — ~40x faster.
	// first_seen / last_seen in the MV correspond to MIN/MAX(created_at) in deviation_events.
	mvWhere := "WHERE first_seen >= $1 AND last_seen <= $2"
	mvArgs  := []interface{}{fromTime, toTime}
	argIdx  := 3
	if driverID != "" {
		mvWhere += fmt.Sprintf(" AND driver_id = $%d", argIdx)
		mvArgs = append(mvArgs, driverID)
		argIdx++
	}

	// ── Total count (instant: index scan on mv_trip_summary) ─────────────────
	var total int
	_ = w.pool.QueryRow(ctx,
		"SELECT COUNT(*)::INT FROM mv_trip_summary "+mvWhere,
		mvArgs...,
	).Scan(&total)

	// ── Paginated query against MV ────────────────────────────────────────────
	pageArgs := make([]interface{}, len(mvArgs))
	copy(pageArgs, mvArgs)
	pageArgs = append(pageArgs, pgSize, offset)

	query := fmt.Sprintf(`
		SELECT
			trip_id,
			driver_id,
			point_count,
			avg_deviation,
			max_deviation,
			is_deviated,
			first_seen,
			last_seen,
			start_lat,
			start_lng
		FROM mv_trip_summary
		%s
		ORDER BY avg_deviation DESC
		LIMIT $%d OFFSET $%d`,
		mvWhere, argIdx, argIdx+1,
	)

	rows, err := w.pool.Query(ctx, query, pageArgs...)

	if err != nil {
		slog.Error("trips-summary query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type TripSummary struct {
		TripID     string  `json:"trip_id"`
		DriverID   string  `json:"driver_id"`
		PointCount int     `json:"point_count"`
		AvgDev     float64 `json:"avg_deviation"`
		MaxDev     float64 `json:"max_deviation"`
		IsDeviated bool    `json:"is_deviated"`
		FirstSeen  string  `json:"first_seen"`
		LastSeen   string  `json:"last_seen"`
		StartLat   float64 `json:"start_lat"`
		StartLng   float64 `json:"start_lng"`
	}

	trips := make([]TripSummary, 0, pgSize)
	for rows.Next() {
		var t TripSummary
		var firstSeen, lastSeen time.Time
		if err := rows.Scan(
			&t.TripID, &t.DriverID, &t.PointCount,
			&t.AvgDev, &t.MaxDev, &t.IsDeviated,
			&firstSeen, &lastSeen,
			&t.StartLat, &t.StartLng,
		); err != nil {
			slog.Error("trips-summary scan failed", "error", err)
			continue
		}
		t.FirstSeen = firstSeen.Format(time.RFC3339)
		t.LastSeen  = lastSeen.Format(time.RFC3339)
		trips = append(trips, t)
	}

	slog.Info("trips-summary",
		"page", page, "page_size", pgSize,
		"returned", len(trips), "total", total,
	)

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"trips":     trips,
		"total":     total,
		"page":      page,
		"page_size": pgSize,
		"has_more":  offset+len(trips) < total,
	})
}

// HandleStatsSummary handles GET /api/stats-summary
// Returns dataset-wide counts from deviation_events in a single fast query.
// Also provides data_from / data_to so the frontend never hardcodes date ranges.
//
// Query params:
//   from=<unix_ms>   filter start (default: epoch — returns full dataset range)
//   to=<unix_ms>     filter end   (default: now+24h)
//   driver_id=<id>   optional driver filter
func (w *PostgresWriter) HandleStatsSummary(wr http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()

	fromStr  := r.URL.Query().Get("from")
	toStr    := r.URL.Query().Get("to")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime   := time.Now().Add(24 * time.Hour)
	if fromStr != "" {
		if ms, err := strconv.ParseInt(fromStr, 10, 64); err == nil {
			fromTime = time.UnixMilli(ms)
		}
	}
	if toStr != "" {
		if ms, err := strconv.ParseInt(toStr, 10, 64); err == nil {
			toTime = time.UnixMilli(ms)
		}
	}

	baseWhere := "WHERE created_at >= $1 AND created_at <= $2"
	args      := []interface{}{fromTime, toTime}
	if driverID != "" {
		baseWhere += " AND driver_id = $3"
		args = append(args, driverID)
	}

	query := fmt.Sprintf(`
		SELECT
			COUNT(*)::INT                                            AS total_points,
			COUNT(DISTINCT trip_id)::INT                             AS total_trips,
			COUNT(DISTINCT driver_id)::INT                           AS total_drivers,
			COUNT(*) FILTER (WHERE deviation_meters > 150)::INT      AS deviated_points,
			COALESCE(AVG(deviation_meters),0)::FLOAT8               AS avg_deviation,
			COALESCE(MAX(deviation_meters),0)::FLOAT8               AS max_deviation,
			MIN(created_at)                                          AS data_from,
			MAX(created_at)                                          AS data_to
		FROM deviation_events
		%s`, baseWhere)

	var totalPoints, totalTrips, totalDrivers, deviatedPoints int
	var avgDev, maxDev float64
	var dataFrom, dataTo time.Time

	if err := w.pool.QueryRow(ctx, query, args...).Scan(
		&totalPoints, &totalTrips, &totalDrivers, &deviatedPoints,
		&avgDev, &maxDev, &dataFrom, &dataTo,
	); err != nil {
		slog.Error("stats-summary query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}

	slog.Info("stats-summary",
		"total_points", totalPoints,
		"total_trips", totalTrips,
		"total_drivers", totalDrivers,
	)

	wr.Header().Set("Content-Type", "application/json")
	json.NewEncoder(wr).Encode(map[string]interface{}{
		"total_points":    totalPoints,
		"total_trips":     totalTrips,
		"total_drivers":   totalDrivers,
		"deviated_points": deviatedPoints,
		"avg_deviation":   math.Round(avgDev*10) / 10,
		"max_deviation":   math.Round(maxDev),
		// data_from / data_to: actual range present in DB — frontend uses this
		// instead of hardcoded dates so the UI stays dataset-agnostic.
		"data_from_ms": dataFrom.UnixMilli(),
		"data_to_ms":   dataTo.UnixMilli(),
	})
}
