// Package ingestion handles WebSocket connections from driver simulators
// and processes incoming GPS data through the filter pipeline.
package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/heat-map-pro/backend/internal/config"

	heatmapv1 "github.com/heat-map-pro/backend/gen/heatmap/v1"
)

// Filter checks whether a GPS point is within the trip's bounding box.
// Defined here (consumer package) per interface-first principle.
type Filter interface {
	// IsInsideBBox returns true if the point is inside the trip's bounding box.
	IsInsideBBox(lat, lng float64, tripID string) bool
	// RegisterTrip stores the bounding box for a new trip.
	RegisterTrip(tripID string, waypoints []Waypoint) BoundingBox
}

// MapMatcher sends GPS points to OSRM for precise map-matching.
type MapMatcher interface {
	// MatchAndDistance returns the deviation distance in meters.
	// Returns 0 if the point matches the road network at the expected location.
	MatchAndDistance(ctx context.Context, lat, lng float64, tripWaypoints []Waypoint) (float64, error)
}

// SpatialIndexer converts GPS coordinates to a spatial cell index.
type SpatialIndexer interface {
	// LatLngToCell converts latitude/longitude to an H3 cell index string.
	LatLngToCell(lat, lng float64) string
}

// DeviationAggregator accumulates deviation counts per spatial cell.
type DeviationAggregator interface {
	// Increment adds 1 to the deviation count for the given H3 cell.
	Increment(h3Index string)
}

// EventPersister buffers deviation events for batch writing to PostgreSQL.
type EventPersister interface {
	// BufferEvent adds a deviation event to the write buffer.
	BufferEvent(event DeviationEventData)
}

// DeviationEventData contains the full data for a single deviation event.
type DeviationEventData struct {
	DriverID        string
	TripID          string
	Latitude        float64
	Longitude       float64
	H3Index         string
	DeviationMeters float64
	Heading         float32
	SpeedKmh        float32
}

// Waypoint represents a point on a planned route.
type Waypoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// BoundingBox represents a geographic bounding rectangle.
type BoundingBox struct {
	MinLat float64 `json:"min_lat"`
	MinLng float64 `json:"min_lng"`
	MaxLat float64 `json:"max_lat"`
	MaxLng float64 `json:"max_lng"`
}

// TripRegistration is the JSON request body for POST /api/trips.
type TripRegistration struct {
	TripID    string     `json:"trip_id"`
	DriverID  string     `json:"driver_id"`
	Waypoints []Waypoint `json:"waypoints"`
}

// Handler manages WebSocket connections and GPS data processing.
type Handler struct {
	filter     Filter
	matcher    MapMatcher
	indexer    SpatialIndexer
	aggregator DeviationAggregator
	persister  EventPersister
	cfg        *config.Config

	upgrader websocket.Upgrader

	// Track active drivers for metrics
	mu             sync.RWMutex
	activeDrivers  map[string]bool
}

// NewHandler creates a new ingestion handler with all dependencies injected.
func NewHandler(
	f Filter,
	m MapMatcher,
	idx SpatialIndexer,
	agg DeviationAggregator,
	p EventPersister,
	cfg *config.Config,
) *Handler {
	return &Handler{
		filter:        f,
		matcher:       m,
		indexer:       idx,
		aggregator:    agg,
		persister:     p,
		cfg:           cfg,
		activeDrivers: make(map[string]bool),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for demo
			},
		},
	}
}

// HandleWebSocket upgrades the HTTP connection to WebSocket and processes GPS batches.
func (h *Handler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("websocket upgrade failed", "error", err)
		return
	}
	defer conn.Close()

	slog.Debug("driver websocket connected", "remote_addr", r.RemoteAddr)

	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			slog.Debug("driver websocket disconnected", "error", err)
			return
		}

		// Accept both TextMessage (JSON) and BinaryMessage (future Protobuf)
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			slog.Warn("unexpected message type", "type", messageType)
			continue
		}

		h.processGPSBatch(r.Context(), data)
	}
}

// processGPSBatch decodes a JSON GPSBatch and runs each point through the filter pipeline.
// NOTE: Currently uses JSON encoding. When protoc is available, switch to proto.Unmarshal
// for ~10x smaller messages in production.
func (h *Handler) processGPSBatch(ctx context.Context, data []byte) {
	var batch heatmapv1.GPSBatch
	if err := json.Unmarshal(data, &batch); err != nil {
		slog.Error("json unmarshal failed", "error", err)
		return
	}

	for _, point := range batch.Points {
		h.processPoint(ctx, point)
	}
}

// processPoint runs a single GPS point through the deviation detection pipeline:
// 1. Bounding box check (fast, in-memory)
// 2. OSRM map-matching (only if outside bbox)
// 3. H3 indexing + aggregation (only if deviation confirmed)
func (h *Handler) processPoint(ctx context.Context, point *heatmapv1.GPSPoint) {
	// Track active driver
	h.mu.Lock()
	h.activeDrivers[point.DriverId] = true
	h.mu.Unlock()

	// Stage 1: Bounding Box Check
	if h.filter.IsInsideBBox(point.Latitude, point.Longitude, point.TripId) {
		// Point is inside bounding box → likely safe, skip OSRM
		return
	}

	// Stage 2: OSRM Map-Matching (only for suspect points)
	// TODO: Pass trip waypoints for comparison. For now, use a simplified check.
	distance, err := h.matcher.MatchAndDistance(ctx, point.Latitude, point.Longitude, nil)
	if err != nil {
		slog.Warn("osrm match failed, skipping point",
			"driver_id", point.DriverId,
			"error", err,
		)
		return
	}

	// Stage 3: Check if deviation exceeds threshold
	if distance <= h.cfg.DeviationThresholdMeters {
		return // GPS noise, not a real deviation
	}

	// Stage 4: H3 Spatial Indexing
	h3Index := h.indexer.LatLngToCell(point.Latitude, point.Longitude)

	// Stage 5: Atomic Aggregation (for real-time Redis → admin dashboard)
	h.aggregator.Increment(h3Index)

	// Stage 6: Buffer for PostgreSQL persistence (batch write every 30s)
	if h.persister != nil {
		h.persister.BufferEvent(DeviationEventData{
			DriverID:        point.DriverId,
			TripID:          point.TripId,
			Latitude:        point.Latitude,
			Longitude:       point.Longitude,
			H3Index:         h3Index,
			DeviationMeters: distance,
			Heading:         point.Heading,
			SpeedKmh:        point.Speed,
		})
	}

	slog.Debug("deviation detected",
		"driver_id", point.DriverId,
		"h3_index", h3Index,
		"distance_m", distance,
	)
}

// RegisterTrip handles POST /api/trips to register a planned route.
func (h *Handler) RegisterTrip(w http.ResponseWriter, r *http.Request) {
	var req TripRegistration
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"invalid request body: %s"}`, err), http.StatusBadRequest)
		return
	}

	if req.TripID == "" || req.DriverID == "" || len(req.Waypoints) < 2 {
		http.Error(w, `{"error":"trip_id, driver_id, and at least 2 waypoints are required"}`, http.StatusBadRequest)
		return
	}

	bbox := h.filter.RegisterTrip(req.TripID, req.Waypoints)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"trip_id":      req.TripID,
		"bounding_box": bbox,
		"status":       "registered",
	})

	slog.Info("trip registered",
		"trip_id", req.TripID,
		"driver_id", req.DriverID,
		"waypoints", len(req.Waypoints),
	)
}

// ActiveDriverCount returns the number of currently active drivers.
func (h *Handler) ActiveDriverCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.activeDrivers)
}
