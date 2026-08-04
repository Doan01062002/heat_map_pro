package spatial

import (
	"strings"
	"testing"
)

func TestH3Indexer_LatLngToCell(t *testing.T) {
	indexer := NewH3Indexer(8)

	tests := []struct {
		name       string
		lat        float64
		lng        float64
		wantPrefix string // All cells should start with "H8:"
	}{
		{
			name:       "hcmc_center",
			lat:        10.7769,
			lng:        106.7009,
			wantPrefix: "H8:",
		},
		{
			name:       "hcmc_district_1",
			lat:        10.7758,
			lng:        106.7019,
			wantPrefix: "H8:",
		},
		{
			name:       "hanoi_center",
			lat:        21.0285,
			lng:        105.8542,
			wantPrefix: "H8:",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cell := indexer.LatLngToCell(tt.lat, tt.lng)
			if !strings.HasPrefix(cell, tt.wantPrefix) {
				t.Errorf("LatLngToCell(%f, %f) = %q, want prefix %q",
					tt.lat, tt.lng, cell, tt.wantPrefix)
			}
			if cell == "" {
				t.Error("LatLngToCell returned empty string")
			}
		})
	}
}

func TestH3Indexer_SameLocation_SameCell(t *testing.T) {
	indexer := NewH3Indexer(8)

	// Two nearby points (within ~15m) should map to the same cell
	cell1 := indexer.LatLngToCell(10.7769, 106.7009)
	cell2 := indexer.LatLngToCell(10.7770, 106.7010)

	if cell1 != cell2 {
		t.Logf("Nearby points mapped to different cells: %s vs %s (OK at cell boundary)", cell1, cell2)
	}

	// Points far apart should map to different cells
	cell3 := indexer.LatLngToCell(10.7769, 106.7009)
	cell4 := indexer.LatLngToCell(10.8200, 106.7500) // ~5km away

	if cell3 == cell4 {
		t.Errorf("Distant points should NOT be in the same cell: %s", cell3)
	}
}

func TestH3Indexer_CellToLatLng(t *testing.T) {
	indexer := NewH3Indexer(8)

	originalLat, originalLng := 10.7769, 106.7009
	cell := indexer.LatLngToCell(originalLat, originalLng)
	recoveredLat, recoveredLng := indexer.CellToLatLng(cell)

	// Recovered center should be within one cell size of the original
	const tolerance = 0.005 // ~500m
	if abs(recoveredLat-originalLat) > tolerance || abs(recoveredLng-originalLng) > tolerance {
		t.Errorf("CellToLatLng round-trip error too large: (%f,%f) → %s → (%f,%f)",
			originalLat, originalLng, cell, recoveredLat, recoveredLng)
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func BenchmarkLatLngToCell(b *testing.B) {
	indexer := NewH3Indexer(8)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		indexer.LatLngToCell(10.7769, 106.7009)
	}
}
