package ingestion

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/heat-map-pro/backend/internal/config"
)

// --- Mock implementations ---

type mockFilter struct {
	mu    sync.Mutex
	trips map[string]BoundingBox
}

func newMockFilter() *mockFilter {
	return &mockFilter{trips: make(map[string]BoundingBox)}
}

func (m *mockFilter) IsInsideBBox(lat, lng float64, tripID string) bool {
	// Return false to force OSRM check (simulate "outside bbox")
	return false
}

func (m *mockFilter) RegisterTrip(tripID string, waypoints []Waypoint) BoundingBox {
	bbox := BoundingBox{
		MinLat: waypoints[0].Latitude,
		MinLng: waypoints[0].Longitude,
		MaxLat: waypoints[0].Latitude,
		MaxLng: waypoints[0].Longitude,
	}
	for _, w := range waypoints {
		if w.Latitude < bbox.MinLat {
			bbox.MinLat = w.Latitude
		}
		if w.Latitude > bbox.MaxLat {
			bbox.MaxLat = w.Latitude
		}
		if w.Longitude < bbox.MinLng {
			bbox.MinLng = w.Longitude
		}
		if w.Longitude > bbox.MaxLng {
			bbox.MaxLng = w.Longitude
		}
	}
	m.mu.Lock()
	m.trips[tripID] = bbox
	m.mu.Unlock()
	return bbox
}

type mockMatcher struct {
	distance float64
	err      error
}

func (m *mockMatcher) MatchAndDistance(_ context.Context, _, _ float64, _ []Waypoint) (float64, error) {
	return m.distance, m.err
}

type mockIndexer struct {
	lastCell string
}

func (m *mockIndexer) LatLngToCell(lat, lng float64) string {
	m.lastCell = "H8:test:cell"
	return m.lastCell
}

type mockAggregator struct {
	mu     sync.Mutex
	counts map[string]int
}

func newMockAggregator() *mockAggregator {
	return &mockAggregator{counts: make(map[string]int)}
}

func (m *mockAggregator) Increment(h3Index string) {
	m.mu.Lock()
	m.counts[h3Index]++
	m.mu.Unlock()
}

func (m *mockAggregator) getCount(h3Index string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.counts[h3Index]
}

type mockPersister struct {
	mu     sync.Mutex
	events []DeviationEventData
}

func (m *mockPersister) BufferEvent(event DeviationEventData) {
	m.mu.Lock()
	m.events = append(m.events, event)
	m.mu.Unlock()
}

func (m *mockPersister) eventCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.events)
}

// --- Tests ---

func newTestHandler(distance float64) (*Handler, *mockFilter, *mockAggregator, *mockPersister) {
	f := newMockFilter()
	m := &mockMatcher{distance: distance}
	idx := &mockIndexer{}
	agg := newMockAggregator()
	p := &mockPersister{}
	cfg := &config.Config{DeviationThresholdMeters: 50}

	h := NewHandler(f, m, idx, agg, p, cfg)
	return h, f, agg, p
}

func TestProcessPoint_DeviationDetected(t *testing.T) {
	// OSRM returns 200m distance (above 50m threshold) → should trigger deviation
	h, _, agg, persister := newTestHandler(200.0)

	batch := `{"points":[{
		"driver_id":"d-001",
		"trip_id":"trip-1",
		"latitude":10.7769,
		"longitude":106.7009,
		"timestamp":1234567890,
		"heading":45,
		"speed":30
	}]}`

	h.processGPSBatch(context.Background(), []byte(batch))

	// Verify aggregator was incremented
	count := agg.getCount("H8:test:cell")
	if count != 1 {
		t.Errorf("expected 1 deviation, got %d", count)
	}

	// Verify persister received the event
	if persister.eventCount() != 1 {
		t.Errorf("expected 1 persisted event, got %d", persister.eventCount())
	}
}

func TestProcessPoint_NoBBoxDeviation(t *testing.T) {
	// OSRM returns 30m distance (below 50m threshold) → no deviation
	h, _, agg, persister := newTestHandler(30.0)

	batch := `{"points":[{
		"driver_id":"d-002",
		"trip_id":"trip-2",
		"latitude":10.7769,
		"longitude":106.7009,
		"timestamp":1234567890,
		"heading":90,
		"speed":40
	}]}`

	h.processGPSBatch(context.Background(), []byte(batch))

	if agg.getCount("H8:test:cell") != 0 {
		t.Error("expected no deviation (distance below threshold)")
	}
	if persister.eventCount() != 0 {
		t.Error("expected no persisted event")
	}
}

func TestProcessGPSBatch_MultiplPoints(t *testing.T) {
	h, _, agg, _ := newTestHandler(200.0)

	batch := `{"points":[
		{"driver_id":"d-001","trip_id":"t-1","latitude":10.77,"longitude":106.70,"timestamp":1000,"heading":0,"speed":20},
		{"driver_id":"d-002","trip_id":"t-2","latitude":10.78,"longitude":106.71,"timestamp":1001,"heading":90,"speed":30},
		{"driver_id":"d-003","trip_id":"t-3","latitude":10.79,"longitude":106.72,"timestamp":1002,"heading":180,"speed":40}
	]}`

	h.processGPSBatch(context.Background(), []byte(batch))

	count := agg.getCount("H8:test:cell")
	if count != 3 {
		t.Errorf("expected 3 deviations from 3 points, got %d", count)
	}
}

func TestProcessGPSBatch_InvalidJSON(t *testing.T) {
	h, _, agg, _ := newTestHandler(200.0)

	// Should log error but not panic
	h.processGPSBatch(context.Background(), []byte(`{invalid json`))

	if agg.getCount("H8:test:cell") != 0 {
		t.Error("expected no deviation from invalid input")
	}
}

func TestRegisterTrip_ValidRequest(t *testing.T) {
	h, filter, _, _ := newTestHandler(200.0)

	body := `{
		"trip_id": "trip-100",
		"driver_id": "d-050",
		"waypoints": [
			{"latitude": 10.77, "longitude": 106.70},
			{"latitude": 10.78, "longitude": 106.71},
			{"latitude": 10.79, "longitude": 106.72}
		]
	}`

	req := httptest.NewRequest("POST", "/api/trips", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.RegisterTrip(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["trip_id"] != "trip-100" {
		t.Errorf("expected trip_id trip-100, got %v", resp["trip_id"])
	}
	if resp["status"] != "registered" {
		t.Errorf("expected status registered, got %v", resp["status"])
	}

	// Verify filter has the trip
	filter.mu.Lock()
	_, exists := filter.trips["trip-100"]
	filter.mu.Unlock()
	if !exists {
		t.Error("trip was not registered in filter")
	}
}

func TestRegisterTrip_MissingFields(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing_trip_id", `{"driver_id":"d-1","waypoints":[{"latitude":10,"longitude":106},{"latitude":11,"longitude":107}]}`},
		{"missing_driver_id", `{"trip_id":"t-1","waypoints":[{"latitude":10,"longitude":106},{"latitude":11,"longitude":107}]}`},
		{"too_few_waypoints", `{"trip_id":"t-1","driver_id":"d-1","waypoints":[{"latitude":10,"longitude":106}]}`},
		{"empty_waypoints", `{"trip_id":"t-1","driver_id":"d-1","waypoints":[]}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, _, _, _ := newTestHandler(200.0)
			req := httptest.NewRequest("POST", "/api/trips", strings.NewReader(tt.body))
			w := httptest.NewRecorder()
			h.RegisterTrip(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400 for %s, got %d", tt.name, w.Code)
			}
		})
	}
}

func TestActiveDriverCount(t *testing.T) {
	h, _, _, _ := newTestHandler(200.0)

	if h.ActiveDriverCount() != 0 {
		t.Error("expected 0 active drivers initially")
	}

	// Process points from 3 different drivers
	batch := `{"points":[
		{"driver_id":"d-001","trip_id":"t-1","latitude":10,"longitude":106,"timestamp":1,"heading":0,"speed":10},
		{"driver_id":"d-002","trip_id":"t-2","latitude":10,"longitude":106,"timestamp":1,"heading":0,"speed":10},
		{"driver_id":"d-003","trip_id":"t-3","latitude":10,"longitude":106,"timestamp":1,"heading":0,"speed":10}
	]}`

	h.processGPSBatch(context.Background(), []byte(batch))

	if h.ActiveDriverCount() != 3 {
		t.Errorf("expected 3 active drivers, got %d", h.ActiveDriverCount())
	}

	// Same driver again — count should stay at 3
	batch2 := `{"points":[{"driver_id":"d-001","trip_id":"t-1","latitude":10,"longitude":106,"timestamp":2,"heading":0,"speed":10}]}`
	h.processGPSBatch(context.Background(), []byte(batch2))

	if h.ActiveDriverCount() != 3 {
		t.Errorf("expected still 3 active drivers, got %d", h.ActiveDriverCount())
	}
}

func TestHandleWebSocket_Integration(t *testing.T) {
	h, _, agg, _ := newTestHandler(200.0)

	// Create test HTTP server with WebSocket handler
	server := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer server.Close()

	// Connect WebSocket client
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("WebSocket dial failed: %v", err)
	}
	defer ws.Close()

	// Send a GPS batch
	batch := `{"points":[{"driver_id":"ws-test","trip_id":"t-ws","latitude":10.77,"longitude":106.70,"timestamp":999,"heading":0,"speed":25}]}`
	if err := ws.WriteMessage(websocket.TextMessage, []byte(batch)); err != nil {
		t.Fatalf("WebSocket write failed: %v", err)
	}

	// Give handler time to process
	sleepMs(200)

	count := agg.getCount("H8:test:cell")
	if count != 1 {
		t.Errorf("expected 1 deviation via WebSocket, got %d", count)
	}
}

func sleepMs(ms int) {
	time.Sleep(time.Duration(ms) * time.Millisecond)
}
