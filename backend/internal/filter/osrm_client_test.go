package filter

import (
	"math"
	"testing"
)

func TestHaversineDistance(t *testing.T) {
	tests := []struct {
		name         string
		lat1, lng1   float64
		lat2, lng2   float64
		wantMeters   float64
		tolerance    float64 // allowed error in meters
	}{
		{
			name:       "same_point",
			lat1:       10.7769, lng1: 106.7009,
			lat2:       10.7769, lng2: 106.7009,
			wantMeters: 0,
			tolerance:  0.01,
		},
		{
			name:       "short_distance_hcmc",
			lat1:       10.7769, lng1: 106.7009,
			lat2:       10.7779, lng2: 106.7019,
			wantMeters: 155.87, // exact Haversine distance
			tolerance:  5.0,    // allow 5m error
		},
		{
			name:       "across_hcmc",
			lat1:       10.7620, lng1: 106.6600,
			lat2:       10.8230, lng2: 106.7290,
			wantMeters: 10139.53, // exact Haversine distance
			tolerance:  100.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := haversineDistance(tt.lat1, tt.lng1, tt.lat2, tt.lng2)
			if math.Abs(got-tt.wantMeters) > tt.tolerance {
				t.Errorf("haversineDistance() = %.2f m, want ~%.2f m (±%.0f m)",
					got, tt.wantMeters, tt.tolerance)
			}
		})
	}
}

// TestOSRMClient_MatchAndDistance_MockServer tests the OSRM client
// against a mock HTTP server instead of a real OSRM instance.
func TestOSRMClient_MatchAndDistance_MockServer(t *testing.T) {
	t.Skip("TODO: Implement with httptest.NewServer returning mock OSRM /nearest response")

	// Example mock response:
	// {
	//   "code": "Ok",
	//   "waypoints": [{
	//     "location": [106.7009, 10.7769],
	//     "distance": 5.2
	//   }]
	// }
}
