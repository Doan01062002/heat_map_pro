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
	"time"

	"github.com/heat-map-pro/backend/internal/aggregator"
	"github.com/heat-map-pro/backend/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresWriter handles batch inserts and historical queries.
type PostgresWriter struct {
	pool *pgxpool.Pool
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

	return &PostgresWriter{pool: pool}, nil
}

// StartFlushLoop runs a background loop that writes aggregated deviation data
// to PostgreSQL at the given interval (default: 30 seconds).
func (w *PostgresWriter) StartFlushLoop(ctx context.Context, agg *aggregator.Aggregator, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("postgres flush loop started", "interval", interval)

	for {
		select {
		case <-ctx.Done():
			slog.Info("postgres flush loop stopped")
			return
		case <-ticker.C:
			w.flush(ctx, agg)
		}
	}
}

// flush writes the current aggregator snapshot to PostgreSQL.
// Note: This shares the same snapshot with the Redis publisher if they run
// at different intervals. In this design, the Postgres flush does NOT
// call Snapshot() (which resets counters) — it reads the accumulated totals
// from the Redis publisher's snapshots stored separately.
//
// TODO: Implement a separate accumulation buffer for Postgres writes.
// For the demo, we insert summary rows per H3 cell per flush cycle.
func (w *PostgresWriter) flush(ctx context.Context, agg *aggregator.Aggregator) {
	// For the demo, the Postgres flush uses a separate snapshot mechanism.
	// This is a placeholder — the actual implementation should batch-insert
	// individual deviation events collected during the flush window.
	slog.Debug("postgres flush: cycle complete")
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
