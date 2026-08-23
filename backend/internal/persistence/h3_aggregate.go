// Package persistence — h3_aggregate.go
// Server-side H3 aggregation handler for /api/h3-aggregate.
//
// Computes H3-like cell aggregation at the requested resolution entirely on
// the server, so the frontend never needs to receive 386k raw GPS points.
// Returns pre-computed GeoJSON-ready polygon boundaries for each cell.
package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/heat-map-pro/backend/internal/spatial"
)

// h3CacheEntry holds a cached response with an expiry timestamp.
type h3CacheEntry struct {
	payload   []byte
	expiresAt time.Time
}

// h3ResponseCache is an in-memory cache for h3-aggregate responses.
// Key: SHA-256 of query params (resolution + bbox + from + to).
// TTL: 60 seconds — long enough to survive rapid pan/zoom, short enough
// that data inserted by live drivers appears within 1 minute.
var h3ResponseCache sync.Map

// h3CacheGet returns (payload, true) if a valid (non-expired) entry exists.
func h3CacheGet(key string) ([]byte, bool) {
	v, ok := h3ResponseCache.Load(key)
	if !ok {
		return nil, false
	}
	entry := v.(h3CacheEntry)
	if time.Now().After(entry.expiresAt) {
		h3ResponseCache.Delete(key)
		return nil, false
	}
	return entry.payload, true
}

// h3CacheSet stores payload under key with a 60s TTL.
func h3CacheSet(key string, payload []byte) {
	h3ResponseCache.Store(key, h3CacheEntry{
		payload:   payload,
		expiresAt: time.Now().Add(60 * time.Second),
	})
}

// aggregatedCell holds the accumulated stats for one H3 grid cell.
type aggregatedCell struct {
	CellIndex      string  `json:"cell"`
	CellSizeDeg    float64 `json:"cell_size"` // degrees — frontend draws hexagon from this
	CenterLat      float64 `json:"center_lat"`
	CenterLng      float64 `json:"center_lng"`
	Count          int     `json:"count"`
	UniqueDrivers  int     `json:"unique_drivers"` // distinct driver_ids in this cell
	AvoidTrips     int     `json:"avoid_trips"`
	TotalTrips     int     `json:"total_trips"`
	AvgDev         float64 `json:"avg_dev"`
	MaxDev         float64 `json:"max_dev"`
	Height         int     `json:"height"`
	Ratio          float64 `json:"ratio"`
}

// HandleH3Aggregate handles GET /api/h3-aggregate?from=<ms>&to=<ms>&resolution=<9-14>
// Optional bbox: min_lat, max_lat, min_lng, max_lng
func (w *PostgresWriter) HandleH3Aggregate(wr http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	// ── Parse parameters ────────────────────────────────────────────────────
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	resStr := r.URL.Query().Get("resolution")
	driverID := r.URL.Query().Get("driver_id")

	fromTime := time.Unix(0, 0)
	toTime := time.Now().Add(24 * time.Hour)
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

	resolution := 10 // default: ~66m cells
	if resStr != "" {
		if n, err := strconv.Atoi(resStr); err == nil && n >= 4 && n <= 14 {
			resolution = n
		}
	}

	// Optional bounding box
	minLatStr := r.URL.Query().Get("min_lat")
	maxLatStr := r.URL.Query().Get("max_lat")
	minLngStr := r.URL.Query().Get("min_lng")
	maxLngStr := r.URL.Query().Get("max_lng")

	hasBBox := minLatStr != "" && maxLatStr != "" && minLngStr != "" && maxLngStr != ""

	// ── Cache key ────────────────────────────────────────────────────────────
	// Round bbox to 2dp (~1.1km) for natural reuse when panning slightly.
	// driver_id is included so per-driver views are cached separately.
	rawKey := fmt.Sprintf("res=%d|from=%s|to=%s|minLat=%s|maxLat=%s|minLng=%s|maxLng=%s|drv=%s",
		resolution, fromStr, toStr,
		roundStr(minLatStr, 2), roundStr(maxLatStr, 2),
		roundStr(minLngStr, 2), roundStr(maxLngStr, 2),
		driverID,
	)
	cacheKey := fmt.Sprintf("%x", sha256.Sum256([]byte(rawKey)))

	if cached, ok := h3CacheGet(cacheKey); ok {
		wr.Header().Set("Content-Type", "application/json")
		wr.Header().Set("X-Cache", "HIT")
		wr.Write(cached)
		return
	}

	// ── Build SQL query ─────────────────────────────────────────────────────
	query := `SELECT latitude, longitude, deviation_meters, trip_id, driver_id, COALESCE(event_type, 'deviation')
	          FROM deviation_events
	          WHERE created_at >= $1 AND created_at <= $2`
	args := []interface{}{fromTime, toTime}
	argIdx := 3

	if driverID != "" {
		query += fmt.Sprintf(" AND driver_id = $%d", argIdx)
		args = append(args, driverID)
		argIdx++
	}

	if hasBBox {
		minLat, _ := strconv.ParseFloat(minLatStr, 64)
		maxLat, _ := strconv.ParseFloat(maxLatStr, 64)
		minLng, _ := strconv.ParseFloat(minLngStr, 64)
		maxLng, _ := strconv.ParseFloat(maxLngStr, 64)
		query += fmt.Sprintf(
			" AND latitude BETWEEN $%d AND $%d AND longitude BETWEEN $%d AND $%d",
			argIdx, argIdx+1, argIdx+2, argIdx+3,
		)
		args = append(args, minLat, maxLat, minLng, maxLng)
	}

	// ── Execute query ───────────────────────────────────────────────────────
	rows, err := w.pool.Query(ctx, query, args...)
	if err != nil {
		slog.Error("h3-aggregate: query failed", "error", err)
		http.Error(wr, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// ── Go-side aggregation ─────────────────────────────────────────────────
	indexer := spatial.NewH3Indexer(resolution)

	type cellAccum struct {
		cell       string
		count      int
		totalDev   float64
		maxDev     float64
		tripsSet   map[string]struct{}
		avoidSet   map[string]struct{}
		driversSet map[string]struct{} // unique driver_ids in this cell
	}

	cellMap := make(map[string]*cellAccum, 8192)
	totalProcessed := 0

	for rows.Next() {
		var lat, lng, deviation float64
		var tripID, drvID, eventType string
		if err := rows.Scan(&lat, &lng, &deviation, &tripID, &drvID, &eventType); err != nil {
			continue
		}
		totalProcessed++

		cell := indexer.LatLngToCell(lat, lng)
		acc, exists := cellMap[cell]
		if !exists {
			acc = &cellAccum{
				cell:       cell,
				tripsSet:   make(map[string]struct{}, 4),
				avoidSet:   make(map[string]struct{}, 4),
				driversSet: make(map[string]struct{}, 4),
			}
			cellMap[cell] = acc
		}

		acc.count++
		acc.totalDev += deviation
		if deviation > acc.maxDev {
			acc.maxDev = deviation
		}

		if tripID == "" {
			tripID = fmt.Sprintf("anon-%d-%d", int(lat*1000), int(lng*1000))
		}
		acc.tripsSet[tripID] = struct{}{}

		// Threshold for bẻ lái / né tránh (High Deviation Detour):
		// - For Simulator ('actual_path'): urban roads are tight, >25m off plan is a detour.
		// - For Porto ('deviation'): highway/city GPS tracking noise is ~50-150m; true avoidance detour is >150m.
		isAvoid := false
		if eventType == "actual_path" {
			isAvoid = deviation > 25
		} else {
			isAvoid = deviation > 150
		}
		if isAvoid {
			acc.avoidSet[tripID] = struct{}{}
		}
		if drvID != "" {
			acc.driversSet[drvID] = struct{}{}
		}
	}

	if err := rows.Err(); err != nil {
		slog.Error("h3-aggregate: rows iteration error", "error", err)
	}

	// ── Build response ──────────────────────────────────────────────────────
	maxAvoidScore := 1
	for _, acc := range cellMap {
		if len(acc.avoidSet) > maxAvoidScore {
			maxAvoidScore = len(acc.avoidSet)
		}
	}

	cells := make([]aggregatedCell, 0, len(cellMap))
	cellSizeDeg := indexer.CellSizeDeg()
	for _, acc := range cellMap {
		centerLat, centerLng := indexer.CellToLatLng(acc.cell)

		avoidTrips := len(acc.avoidSet)
		totalTrips := len(acc.tripsSet)
		uniqueDrivers := len(acc.driversSet)
		ratio := float64(avoidTrips) / float64(maxAvoidScore)
		avgDev := acc.totalDev / float64(acc.count)

		cells = append(cells, aggregatedCell{
			CellIndex:     acc.cell,
			CellSizeDeg:   cellSizeDeg,
			CenterLat:     math.Round(centerLat*1e6) / 1e6,
			CenterLng:     math.Round(centerLng*1e6) / 1e6,
			Count:         acc.count,
			UniqueDrivers: uniqueDrivers,
			AvoidTrips:    avoidTrips,
			TotalTrips:    totalTrips,
			AvgDev:        math.Round(avgDev*10) / 10,
			MaxDev:        math.Round(acc.maxDev*10) / 10,
			Height:        maxInt(10, int(math.Round(ratio*250))),
			Ratio:         math.Round(ratio*1000) / 1000,
		})
	}

	slog.Info("h3-aggregate",
		"resolution", resolution,
		"total_processed", totalProcessed,
		"total_cells", len(cells),
		"has_bbox", hasBBox,
	)

	payload, err := json.Marshal(map[string]interface{}{
		"cells":                  cells,
		"total_cells":            len(cells),
		"resolution":             resolution,
		"total_points_processed": totalProcessed,
	})
	if err != nil {
		http.Error(wr, `{"error":"json encode failed"}`, http.StatusInternalServerError)
		return
	}

	// Store in cache (only non-empty responses)
	if len(cells) > 0 {
		h3CacheSet(cacheKey, payload)
	}

	wr.Header().Set("Content-Type", "application/json")
	wr.Header().Set("X-Cache", "MISS")
	wr.Write(payload)
}

// roundStr parses a float string and returns it rounded to `dp` decimal places.
// Returns "" if input is empty or unparseable.
func roundStr(s string, dp int) string {
	if s == "" {
		return ""
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return s
	}
	factor := math.Pow(10, float64(dp))
	return strconv.FormatFloat(math.Round(f*factor)/factor, 'f', dp, 64)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
