package filter

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/heat-map-pro/backend/internal/ingestion"
)

// osrmClient implements the ingestion.MapMatcher interface.
// It calls the OSRM /match API to snap GPS points to the road network
// and compute the deviation distance from the planned route.
type osrmClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewOSRMClient creates a new OSRM map-matching client.
func NewOSRMClient(baseURL string, timeout time.Duration) *osrmClient {
	return &osrmClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:    30 * time.Second,
			},
		},
	}
}

// osrmMatchResponse represents the relevant fields from OSRM /match response.
type osrmMatchResponse struct {
	Code        string           `json:"code"`
	Tracepoints []osrmTracepoint `json:"tracepoints"`
}

type osrmTracepoint struct {
	Location  [2]float64 `json:"location"` // [lng, lat] (OSRM convention)
	Name      string     `json:"name"`
	Alternatives_Count int `json:"alternatives_count"`
}

// MatchAndDistance sends the GPS point to OSRM /match and returns
// the deviation distance from the planned route in meters.
//
// For this demo, we use a simplified approach:
// - Send the suspect point to OSRM /nearest to find the nearest road
// - Compare the matched position with the planned route waypoints
// - Return the distance between matched position and nearest planned waypoint
func (c *osrmClient) MatchAndDistance(ctx context.Context, lat, lng float64, tripWaypoints []ingestion.Waypoint) (float64, error) {
	// Build OSRM /nearest request
	// Note: OSRM expects longitude,latitude order
	url := fmt.Sprintf("%s/nearest/v1/driving/%.6f,%.6f?number=1", c.baseURL, lng, lat)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("osrmClient.MatchAndDistance: create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("osrmClient.MatchAndDistance: HTTP request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("osrmClient.MatchAndDistance: OSRM returned status %d", resp.StatusCode)
	}

	var result struct {
		Code      string `json:"code"`
		Waypoints []struct {
			Location [2]float64 `json:"location"` // [lng, lat]
			Distance float64    `json:"distance"`  // meters from input to snapped point
		} `json:"waypoints"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("osrmClient.MatchAndDistance: decode response: %w", err)
	}

	if result.Code != "Ok" || len(result.Waypoints) == 0 {
		slog.Debug("osrm returned no waypoints", "code", result.Code, "lat", lat, "lng", lng)
		return math.MaxFloat64, nil // Cannot match → treat as large deviation
	}

	// The matched point on the road network
	matchedLng := result.Waypoints[0].Location[0]
	matchedLat := result.Waypoints[0].Location[1]

	// If we have trip waypoints, calculate distance to nearest planned waypoint
	if len(tripWaypoints) > 0 {
		minDist := math.MaxFloat64
		for _, wp := range tripWaypoints {
			d := haversineDistance(matchedLat, matchedLng, wp.Latitude, wp.Longitude)
			if d < minDist {
				minDist = d
			}
		}
		return minDist, nil
	}

	// Fallback: return the OSRM snap distance (distance from GPS to nearest road)
	return result.Waypoints[0].Distance, nil
}

// haversineDistance calculates the distance between two GPS points in meters.
func haversineDistance(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusMeters = 6371000.0

	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLng := (lng2 - lng1) * math.Pi / 180.0

	lat1Rad := lat1 * math.Pi / 180.0
	lat2Rad := lat2 * math.Pi / 180.0

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(dLng/2)*math.Sin(dLng/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusMeters * c
}

// SnapResult holds the result of snapping a GPS point to the nearest road.
type SnapResult struct {
	SnappedLat float64 // Latitude of the point on the road centerline
	SnappedLng float64 // Longitude of the point on the road centerline
	WayName    string  // OSM road/street name from OSRM
	Distance   float64 // Distance in meters from original GPS to snapped point
}

// SnapToRoadWithName snaps a GPS point to the nearest road via OSRM /nearest
// and returns the snapped coordinates plus the OSM road name.
// This enables Lixel Binning: grouping deviation events by road name.
func (c *osrmClient) SnapToRoadWithName(ctx context.Context, lat, lng float64) (SnapResult, error) {
	url := fmt.Sprintf("%s/nearest/v1/driving/%.6f,%.6f?number=1", c.baseURL, lng, lat)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return SnapResult{}, fmt.Errorf("osrmClient.SnapToRoadWithName: create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return SnapResult{}, fmt.Errorf("osrmClient.SnapToRoadWithName: HTTP request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return SnapResult{}, fmt.Errorf("osrmClient.SnapToRoadWithName: OSRM returned status %d", resp.StatusCode)
	}

	var result struct {
		Code      string `json:"code"`
		Waypoints []struct {
			Location [2]float64 `json:"location"` // [lng, lat]
			Name     string     `json:"name"`
			Distance float64    `json:"distance"`
		} `json:"waypoints"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return SnapResult{}, fmt.Errorf("osrmClient.SnapToRoadWithName: decode response: %w", err)
	}

	if result.Code != "Ok" || len(result.Waypoints) == 0 {
		return SnapResult{}, fmt.Errorf("osrmClient.SnapToRoadWithName: no match (code=%s)", result.Code)
	}

	wp := result.Waypoints[0]
	return SnapResult{
		SnappedLat: wp.Location[1],
		SnappedLng: wp.Location[0],
		WayName:    wp.Name,
		Distance:   wp.Distance,
	}, nil
}
