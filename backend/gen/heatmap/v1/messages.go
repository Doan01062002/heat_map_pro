// Package heatmapv1 contains message types for the heatmap system.
//
// These types mirror proto/heatmap/v1/messages.proto.
//
// IMPORTANT: This file is HAND-WRITTEN because protoc is not available
// on this development machine. When protoc + protoc-gen-go are installed,
// replace this file with proper generated code via: cd backend && make proto
//
// For now, the system uses JSON encoding over WebSocket instead of binary Protobuf.
// This is acceptable for a demo with <1000 drivers. For production, switch to
// Protobuf binary encoding for ~10x smaller message sizes.
package heatmapv1

// ==============================================================================
// Messages: Simulator → Backend
// ==============================================================================

// GPSPoint represents a single GPS reading from a simulated driver.
type GPSPoint struct {
	DriverId  string  `json:"driver_id"`
	TripId    string  `json:"trip_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Timestamp int64   `json:"timestamp"`
	Heading   float32 `json:"heading"`
	Speed     float32 `json:"speed"`
}

// GPSBatch is sent from the simulator every 3 seconds.
// Contains GPS readings from one or more drivers.
type GPSBatch struct {
	Points []*GPSPoint `json:"points"`
}

// TripRoute is sent once when a trip starts to register the planned route.
type TripRoute struct {
	TripId    string      `json:"trip_id"`
	DriverId  string      `json:"driver_id"`
	Waypoints []*Waypoint `json:"waypoints"`
}

// Waypoint is a single point on a planned route.
type Waypoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// ==============================================================================
// Messages: Backend → Admin Dashboard
// ==============================================================================

// HeatmapCell represents one hexagonal cell on the heatmap.
type HeatmapCell struct {
	H3Index     string `json:"h3_index"`
	Intensity   uint32 `json:"intensity"`
	LastUpdated int64  `json:"last_updated"`
}

// HeatmapUpdate is pushed to admin clients every 1 second.
// Contains only cells that changed since the last update (delta).
type HeatmapUpdate struct {
	Cells           []*HeatmapCell `json:"cells"`
	ServerTimestamp  int64          `json:"server_timestamp"`
	TotalDrivers    uint32         `json:"total_drivers"`
	TotalDeviations uint32         `json:"total_deviations"`
}
