package filter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/heat-map-pro/backend/internal/ingestion"
)

// --- OSRM Client Tests (mock /nearest endpoint) ---

// mockNearestResponse builds a response matching OSRM /nearest/v1/driving format.
func mockNearestResponse(distance float64, snappedLat, snappedLng float64) map[string]interface{} {
	return map[string]interface{}{
		"code": "Ok",
		"waypoints": []map[string]interface{}{
			{
				"distance": distance,
				"location": []float64{snappedLng, snappedLat}, // OSRM: [lng, lat]
				"name":     "Test Road",
			},
		},
	}
}

func TestOSRMClient_MatchAndDistance_OnRoute(t *testing.T) {
	// Snapped point is at (10.775, 106.705) — same as the trip waypoint
	// so distance to nearest waypoint should be ~0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(mockNearestResponse(5.0, 10.775, 106.705))
	}))
	defer server.Close()

	waypoints := []ingestion.Waypoint{
		{Latitude: 10.77, Longitude: 106.70},
		{Latitude: 10.78, Longitude: 106.71}, // nearest waypoint to snapped point
	}

	client := NewOSRMClient(server.URL, 500_000_000)
	dist, err := client.MatchAndDistance(context.Background(), 10.775, 106.705, waypoints)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Distance should be small (≤ 1000m) — snapped point is near waypoint
	if dist > 1000 {
		t.Errorf("expected small distance (on-route), got %.1fm", dist)
	}
}

func TestOSRMClient_MatchAndDistance_LargeDeviation(t *testing.T) {
	// Snapped point is far from all trip waypoints (different district)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Snapped 5km away from route
		json.NewEncoder(w).Encode(mockNearestResponse(10.0, 10.85, 107.10))
	}))
	defer server.Close()

	waypoints := []ingestion.Waypoint{
		{Latitude: 10.77, Longitude: 106.70},
		{Latitude: 10.78, Longitude: 106.71},
	}

	client := NewOSRMClient(server.URL, 500_000_000)
	dist, err := client.MatchAndDistance(context.Background(), 10.85, 107.10, waypoints)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Snapped point (10.85, 107.10) is far from route (10.77-10.78, 106.70-106.71)
	if dist < 50 {
		t.Errorf("expected large deviation distance, got %.1fm", dist)
	}
}

func TestOSRMClient_MatchAndDistance_NoSegment(t *testing.T) {
	// OSRM returns NoSegment (cannot snap to road)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"code":    "NoSegment",
			"message": "could not find a matching segment",
		})
	}))
	defer server.Close()

	waypoints := []ingestion.Waypoint{
		{Latitude: 10.77, Longitude: 106.70},
		{Latitude: 10.78, Longitude: 106.71},
	}

	client := NewOSRMClient(server.URL, 500_000_000)
	dist, err := client.MatchAndDistance(context.Background(), 10.77, 106.70, waypoints)

	// NoSegment returns MaxFloat64 (treat as large deviation) with nil error
	if err != nil {
		t.Errorf("expected nil error for NoSegment (treated as max deviation), got: %v", err)
	}
	if dist == 0 {
		t.Error("expected non-zero distance for NoSegment response")
	}
}

func TestOSRMClient_MatchAndDistance_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "internal server error", http.StatusInternalServerError)
	}))
	defer server.Close()

	waypoints := []ingestion.Waypoint{
		{Latitude: 10.77, Longitude: 106.70},
		{Latitude: 10.78, Longitude: 106.71},
	}

	client := NewOSRMClient(server.URL, 500_000_000)
	_, err := client.MatchAndDistance(context.Background(), 10.77, 106.70, waypoints)

	if err == nil {
		t.Error("expected error for HTTP 500 response")
	}
}

func TestOSRMClient_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()

	waypoints := []ingestion.Waypoint{
		{Latitude: 10.77, Longitude: 106.70},
		{Latitude: 10.78, Longitude: 106.71},
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	client := NewOSRMClient(server.URL, 500_000_000)
	_, err := client.MatchAndDistance(ctx, 10.77, 106.70, waypoints)

	if err == nil {
		t.Error("expected error for cancelled context")
	}
}

func TestOSRMClient_FallbackDistance_NoWaypoints(t *testing.T) {
	// When no trip waypoints provided, fallback to OSRM snap distance
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(mockNearestResponse(42.5, 10.775, 106.705))
	}))
	defer server.Close()

	client := NewOSRMClient(server.URL, 500_000_000)
	// Empty waypoints → fallback to OSRM snap distance (42.5m)
	dist, err := client.MatchAndDistance(context.Background(), 10.77, 106.70, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dist != 42.5 {
		t.Errorf("expected fallback snap distance 42.5, got %.1f", dist)
	}
}
