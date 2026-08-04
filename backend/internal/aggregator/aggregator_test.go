package aggregator

import (
	"sync"
	"testing"
)

func TestNew(t *testing.T) {
	agg := New()
	if agg == nil {
		t.Fatal("New() returned nil")
	}

	snap := agg.Snapshot()
	if len(snap) != 0 {
		t.Errorf("expected empty snapshot, got %d entries", len(snap))
	}
}

func TestIncrement_SingleCell(t *testing.T) {
	agg := New()

	agg.Increment("H8:100:200")
	agg.Increment("H8:100:200")
	agg.Increment("H8:100:200")

	snap := agg.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 cell, got %d", len(snap))
	}
	if snap[0].H3Index != "H8:100:200" {
		t.Errorf("expected H8:100:200, got %s", snap[0].H3Index)
	}
	if snap[0].Intensity != 3 {
		t.Errorf("expected intensity 3, got %d", snap[0].Intensity)
	}
}

func TestIncrement_MultipleCells(t *testing.T) {
	agg := New()

	agg.Increment("H8:100:200")
	agg.Increment("H8:100:200")
	agg.Increment("H8:101:201")
	agg.Increment("H8:102:202")
	agg.Increment("H8:102:202")
	agg.Increment("H8:102:202")

	snap := agg.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("expected 3 cells, got %d", len(snap))
	}

	// Build a map for easier assertion
	cellMap := make(map[string]uint64)
	for _, s := range snap {
		cellMap[s.H3Index] = s.Intensity
	}

	tests := []struct {
		cell     string
		expected uint64
	}{
		{"H8:100:200", 2},
		{"H8:101:201", 1},
		{"H8:102:202", 3},
	}

	for _, tt := range tests {
		if cellMap[tt.cell] != tt.expected {
			t.Errorf("cell %s: expected %d, got %d", tt.cell, tt.expected, cellMap[tt.cell])
		}
	}
}

func TestSnapshot_ResetsCounts(t *testing.T) {
	agg := New()

	agg.Increment("H8:100:200")
	agg.Increment("H8:100:200")

	snap1 := agg.Snapshot()
	if len(snap1) != 1 || snap1[0].Intensity != 2 {
		t.Fatalf("first snapshot wrong: %+v", snap1)
	}

	// Second snapshot should be empty (counters reset)
	snap2 := agg.Snapshot()
	if len(snap2) != 0 {
		t.Errorf("expected empty snapshot after reset, got %d entries", len(snap2))
	}
}

func TestIncrement_Concurrent(t *testing.T) {
	agg := New()
	cell := "H8:concurrent:test"
	goroutines := 100
	incrementsPerGoroutine := 100

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < incrementsPerGoroutine; j++ {
				agg.Increment(cell)
			}
		}()
	}

	wg.Wait()

	snap := agg.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 cell, got %d", len(snap))
	}

	expected := uint64(goroutines * incrementsPerGoroutine)
	if snap[0].Intensity != expected {
		t.Errorf("expected intensity %d, got %d (lost increments under concurrency)", expected, snap[0].Intensity)
	}
}
