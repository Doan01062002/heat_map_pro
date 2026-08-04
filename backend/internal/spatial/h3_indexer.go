// Package spatial provides H3 spatial indexing for GPS coordinates.
// It converts raw (lat, lng) pairs into H3 hexagonal cell indices.
package spatial

import (
	"github.com/uber/h3-go/v4"
)

// h3Indexer implements the ingestion.SpatialIndexer interface.
type h3Indexer struct {
	resolution int
}

// NewH3Indexer creates a new H3 indexer at the given resolution level.
// Resolution 8 (~460m hexagon diameter) is recommended for city-level heatmaps.
func NewH3Indexer(resolution int) *h3Indexer {
	return &h3Indexer{resolution: resolution}
}

// LatLngToCell converts latitude/longitude to an H3 cell index string.
// This is an O(1) pure computation — no network calls, no allocations beyond the string.
func (idx *h3Indexer) LatLngToCell(lat, lng float64) string {
	latLng := h3.NewLatLng(lat, lng)
	cell := h3.LatLngToCell(latLng, idx.resolution)
	return cell.String()
}

// CellToLatLng returns the center coordinates of an H3 cell (for visualization).
func (idx *h3Indexer) CellToLatLng(h3Index string) (lat, lng float64) {
	cell, err := h3.CellFromString(h3Index)
	if err != nil {
		return 0, 0
	}
	latLng := h3.CellToLatLng(cell)
	return latLng.Lat, latLng.Lng
}

// Resolution returns the configured H3 resolution level.
func (idx *h3Indexer) Resolution() int {
	return idx.resolution
}
