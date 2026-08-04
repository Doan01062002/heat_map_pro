// Package spatial provides H3-like spatial indexing for GPS coordinates.
// It converts raw (lat, lng) pairs into hexagonal cell index strings.
//
// IMPLEMENTATION NOTE: This uses a PURE GO geohash-based grid instead of
// the real H3 library (uber/h3-go) because h3-go requires CGO (C compiler)
// which is not available on this development machine.
//
// The grid cells are similar in concept to H3 Resolution 8 (~460m diameter):
// we divide the earth into ~460m cells using a simple (lat, lng) grid.
// This is sufficient for the demo. In production, replace with h3-go.
package spatial

import (
	"fmt"
	"math"
)

// h3Indexer implements a simplified spatial indexer using a grid-based approach.
// Each cell is approximately 460m × 460m (similar to H3 Resolution 8).
type h3Indexer struct {
	resolution int
	cellSizeDeg float64 // cell size in degrees
}

// Resolution to approximate cell size mapping (in degrees latitude).
// H3 Resolution 8 ≈ 460m ≈ 0.00414 degrees
var resolutionToCellSize = map[int]float64{
	4:  0.1326,    // ~14.7 km
	5:  0.0500,    // ~5.6 km
	6:  0.0189,    // ~2.1 km
	7:  0.00713,   // ~793 m
	8:  0.00414,   // ~460 m (default)
	9:  0.00156,   // ~174 m
	10: 0.000589,  // ~66 m
}

// NewH3Indexer creates a new spatial indexer at the given resolution level.
// Resolution 8 (~460m cell diameter) is recommended for city-level heatmaps.
func NewH3Indexer(resolution int) *h3Indexer {
	cellSize, ok := resolutionToCellSize[resolution]
	if !ok {
		cellSize = resolutionToCellSize[8] // default to resolution 8
	}
	return &h3Indexer{
		resolution:  resolution,
		cellSizeDeg: cellSize,
	}
}

// LatLngToCell converts latitude/longitude to a cell index string.
//
// The returned string format is "H<resolution>:<latGrid>:<lngGrid>"
// For example: "H8:2602:25773" for a point in Ho Chi Minh City.
//
// This is O(1) computation with no allocations beyond the returned string.
func (idx *h3Indexer) LatLngToCell(lat, lng float64) string {
	// Normalize longitude to [0, 360) range
	normalizedLng := lng
	if normalizedLng < 0 {
		normalizedLng += 360.0
	}

	// Convert to grid coordinates
	latGrid := int(math.Floor((lat + 90.0) / idx.cellSizeDeg))
	lngGrid := int(math.Floor(normalizedLng / idx.cellSizeDeg))

	return fmt.Sprintf("H%d:%d:%d", idx.resolution, latGrid, lngGrid)
}

// CellToLatLng returns the center coordinates of a cell (for visualization).
func (idx *h3Indexer) CellToLatLng(cellIndex string) (lat, lng float64) {
	var res, latGrid, lngGrid int
	_, err := fmt.Sscanf(cellIndex, "H%d:%d:%d", &res, &latGrid, &lngGrid)
	if err != nil {
		return 0, 0
	}

	cellSize, ok := resolutionToCellSize[res]
	if !ok {
		cellSize = resolutionToCellSize[8]
	}

	lat = float64(latGrid)*cellSize - 90.0 + cellSize/2.0
	lng = float64(lngGrid)*cellSize + cellSize/2.0

	// Normalize back to [-180, 180)
	if lng > 180.0 {
		lng -= 360.0
	}

	return lat, lng
}

// Resolution returns the configured resolution level.
func (idx *h3Indexer) Resolution() int {
	return idx.resolution
}
