package filter

import (
	"math"
	"testing"

	"github.com/heat-map-pro/backend/internal/ingestion"
)

func TestBoundingBoxFilter_RegisterTrip(t *testing.T) {
	tests := []struct {
		name          string
		waypoints     []ingestion.Waypoint
		bufferMeters  float64
		wantMinLat    float64
		wantMaxLat    float64
	}{
		{
			name: "simple_two_points",
			waypoints: []ingestion.Waypoint{
				{Latitude: 10.7700, Longitude: 106.7000},
				{Latitude: 10.7800, Longitude: 106.7100},
			},
			bufferMeters: 50.0,
			wantMinLat:   10.7695, // 10.77 - 50m buffer
			wantMaxLat:   10.7805, // 10.78 + 50m buffer
		},
		{
			name:         "empty_waypoints",
			waypoints:    []ingestion.Waypoint{},
			bufferMeters: 50.0,
			wantMinLat:   0,
			wantMaxLat:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := NewBoundingBoxFilter(tt.bufferMeters)
			bbox := f.RegisterTrip("trip-1", tt.waypoints)

			if len(tt.waypoints) == 0 {
				return // Skip bbox validation for empty waypoints
			}

			// Allow small floating-point tolerance (0.001 degrees ≈ 111m)
			const tolerance = 0.001
			if math.Abs(bbox.MinLat-tt.wantMinLat) > tolerance {
				t.Errorf("MinLat = %f, want ~%f", bbox.MinLat, tt.wantMinLat)
			}
			if math.Abs(bbox.MaxLat-tt.wantMaxLat) > tolerance {
				t.Errorf("MaxLat = %f, want ~%f", bbox.MaxLat, tt.wantMaxLat)
			}
		})
	}
}

func TestBoundingBoxFilter_IsInsideBBox(t *testing.T) {
	f := NewBoundingBoxFilter(50.0)
	f.RegisterTrip("trip-1", []ingestion.Waypoint{
		{Latitude: 10.7700, Longitude: 106.7000},
		{Latitude: 10.7800, Longitude: 106.7100},
	})

	tests := []struct {
		name   string
		lat    float64
		lng    float64
		tripID string
		want   bool
	}{
		{"center_point", 10.7750, 106.7050, "trip-1", true},
		{"inside_edge", 10.7701, 106.7001, "trip-1", true},
		{"outside_far", 10.9000, 106.9000, "trip-1", false},
		{"unknown_trip", 10.7750, 106.7050, "trip-unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := f.IsInsideBBox(tt.lat, tt.lng, tt.tripID)
			if got != tt.want {
				t.Errorf("IsInsideBBox(%f, %f, %s) = %v, want %v",
					tt.lat, tt.lng, tt.tripID, got, tt.want)
			}
		})
	}
}
