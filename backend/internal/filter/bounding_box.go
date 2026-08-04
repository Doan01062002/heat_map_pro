// Package filter implements the two-stage GPS point filtering pipeline:
// 1. Bounding Box pre-filter (fast, in-memory)
// 2. OSRM map-matching (precise, HTTP)
package filter

import (
	"math"
	"sync"

	"github.com/heat-map-pro/backend/internal/ingestion"
)

// boundingBoxFilter implements the ingestion.Filter interface.
// It stores bounding boxes for active trips and performs O(1) containment checks.
type boundingBoxFilter struct {
	bufferMeters float64

	mu    sync.RWMutex
	boxes map[string]ingestion.BoundingBox // trip_id → bounding box
}

// NewBoundingBoxFilter creates a new filter with the given buffer distance in meters.
func NewBoundingBoxFilter(bufferMeters float64) *boundingBoxFilter {
	return &boundingBoxFilter{
		bufferMeters: bufferMeters,
		boxes:        make(map[string]ingestion.BoundingBox),
	}
}

// RegisterTrip computes and stores the bounding box for a trip's planned route.
// The bounding box is expanded by bufferMeters in all directions.
func (f *boundingBoxFilter) RegisterTrip(tripID string, waypoints []ingestion.Waypoint) ingestion.BoundingBox {
	if len(waypoints) == 0 {
		return ingestion.BoundingBox{}
	}

	minLat, maxLat := waypoints[0].Latitude, waypoints[0].Latitude
	minLng, maxLng := waypoints[0].Longitude, waypoints[0].Longitude

	for _, wp := range waypoints[1:] {
		if wp.Latitude < minLat {
			minLat = wp.Latitude
		}
		if wp.Latitude > maxLat {
			maxLat = wp.Latitude
		}
		if wp.Longitude < minLng {
			minLng = wp.Longitude
		}
		if wp.Longitude > maxLng {
			maxLng = wp.Longitude
		}
	}

	// Convert buffer from meters to approximate degrees
	// 1 degree latitude ≈ 111,320 meters (constant)
	// 1 degree longitude ≈ 111,320 * cos(latitude) meters (varies)
	latBuffer := f.bufferMeters / 111320.0
	centerLat := (minLat + maxLat) / 2.0
	lngBuffer := f.bufferMeters / (111320.0 * math.Cos(centerLat*math.Pi/180.0))

	bbox := ingestion.BoundingBox{
		MinLat: minLat - latBuffer,
		MinLng: minLng - lngBuffer,
		MaxLat: maxLat + latBuffer,
		MaxLng: maxLng + lngBuffer,
	}

	f.mu.Lock()
	f.boxes[tripID] = bbox
	f.mu.Unlock()

	return bbox
}

// IsInsideBBox returns true if the given point falls within the trip's bounding box.
// If the trip is not found, returns false (treat as suspect = send to OSRM).
func (f *boundingBoxFilter) IsInsideBBox(lat, lng float64, tripID string) bool {
	f.mu.RLock()
	bbox, exists := f.boxes[tripID]
	f.mu.RUnlock()

	if !exists {
		return false // Unknown trip → treat as suspect
	}

	return lat >= bbox.MinLat &&
		lat <= bbox.MaxLat &&
		lng >= bbox.MinLng &&
		lng <= bbox.MaxLng
}

// RemoveTrip removes the bounding box for a completed trip.
func (f *boundingBoxFilter) RemoveTrip(tripID string) {
	f.mu.Lock()
	delete(f.boxes, tripID)
	f.mu.Unlock()
}
