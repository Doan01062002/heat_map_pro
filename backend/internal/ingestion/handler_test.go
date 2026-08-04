package ingestion

import (
	"testing"
)

// TestProcessPoint_InsideBBox verifies that points inside the bounding box
// are NOT sent to OSRM and do NOT increment the aggregator.
func TestProcessPoint_InsideBBox(t *testing.T) {
	t.Skip("TODO: Implement with mock Filter, MapMatcher, SpatialIndexer, and DeviationAggregator")

	// Table-driven test cases:
	// | Name               | Lat     | Lng      | InsideBBox | ExpectOSRM | ExpectAgg |
	// |--------------------|---------|----------|------------|------------|-----------|
	// | inside_bbox_safe   | 10.7800 | 106.7050 | true       | false      | false     |
	// | outside_bbox_safe  | 10.9000 | 106.9000 | false      | true       | false     | (OSRM says <50m)
	// | outside_bbox_deviated | 10.9500 | 106.9500 | false   | true       | true      | (OSRM says >50m)
}

// TestHandleWebSocket_InvalidProtobuf verifies that invalid binary data
// is handled gracefully without crashing.
func TestHandleWebSocket_InvalidProtobuf(t *testing.T) {
	t.Skip("TODO: Implement with test WebSocket server and invalid data payload")
}

// TestRegisterTrip_ValidRequest verifies successful trip registration.
func TestRegisterTrip_ValidRequest(t *testing.T) {
	t.Skip("TODO: Implement with httptest.NewRequest and response recorder")
}

// TestRegisterTrip_MissingFields verifies that incomplete requests return 400.
func TestRegisterTrip_MissingFields(t *testing.T) {
	t.Skip("TODO: Implement with table-driven test for various missing field combinations")
}
