package aggregator

import (
	"sync"
	"testing"
)

func TestAggregator_Increment(t *testing.T) {
	agg := New()

	agg.Increment("cell-a")
	agg.Increment("cell-a")
	agg.Increment("cell-b")

	snap := agg.Snapshot()

	counts := make(map[string]uint64)
	for _, s := range snap {
		counts[s.H3Index] = s.Intensity
	}

	if counts["cell-a"] != 2 {
		t.Errorf("cell-a = %d, want 2", counts["cell-a"])
	}
	if counts["cell-b"] != 1 {
		t.Errorf("cell-b = %d, want 1", counts["cell-b"])
	}
}

func TestAggregator_SnapshotResetsCounters(t *testing.T) {
	agg := New()

	agg.Increment("cell-a")
	agg.Increment("cell-a")

	// First snapshot should return count=2
	snap1 := agg.Snapshot()
	if len(snap1) != 1 || snap1[0].Intensity != 2 {
		t.Fatalf("snap1: got %v, want [{cell-a, 2}]", snap1)
	}

	// Second snapshot should return empty (counters were reset)
	snap2 := agg.Snapshot()
	if len(snap2) != 0 {
		t.Errorf("snap2: got %v, want empty (counters should be reset)", snap2)
	}
}

func TestAggregator_ConcurrentIncrements(t *testing.T) {
	agg := New()

	const numGoroutines = 100
	const incrementsPerGoroutine = 1000

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < incrementsPerGoroutine; j++ {
				agg.Increment("shared-cell")
			}
		}()
	}

	wg.Wait()

	snap := agg.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 cell, got %d", len(snap))
	}

	expected := uint64(numGoroutines * incrementsPerGoroutine)
	if snap[0].Intensity != expected {
		t.Errorf("shared-cell = %d, want %d (concurrent safety issue!)",
			snap[0].Intensity, expected)
	}
}

func BenchmarkAggregator_Increment(b *testing.B) {
	agg := New()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			agg.Increment("bench-cell")
		}
	})
}
