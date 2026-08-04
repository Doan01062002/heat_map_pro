// Package aggregator provides a lock-free in-memory counter for H3 cell deviations.
// It uses sync.Map + atomic operations to avoid mutex contention under high concurrency.
package aggregator

import (
	"sync"
	"sync/atomic"
)

// CellSnapshot represents the deviation count for a single H3 cell
// at the time of snapshot.
type CellSnapshot struct {
	H3Index   string
	Intensity uint64
}

// Aggregator accumulates deviation counts per H3 cell using lock-free atomic operations.
// Multiple goroutines can safely call Increment concurrently without any locks.
type Aggregator struct {
	cells sync.Map // map[string]*uint64
}

// New creates a new lock-free aggregator.
func New() *Aggregator {
	return &Aggregator{}
}

// Increment atomically adds 1 to the deviation count for the given H3 cell.
// This compiles to a single CPU LOCK XADD instruction — zero lock contention.
func (a *Aggregator) Increment(h3Index string) {
	// LoadOrStore is safe for concurrent access — sync.Map guarantees this.
	val, _ := a.cells.LoadOrStore(h3Index, new(uint64))
	counter := val.(*uint64)
	atomic.AddUint64(counter, 1)
}

// Snapshot takes a point-in-time snapshot of all cell counters and atomically
// resets them to zero. This is called by the flush goroutine every 1 second.
//
// The snapshot is non-blocking: other goroutines can continue calling Increment
// during the snapshot. Any increments that happen during the snapshot will be
// captured in the NEXT snapshot cycle.
func (a *Aggregator) Snapshot() []CellSnapshot {
	var result []CellSnapshot

	a.cells.Range(func(key, value any) bool {
		h3Index := key.(string)
		counter := value.(*uint64)

		// Atomically swap the counter to 0 and read the old value.
		count := atomic.SwapUint64(counter, 0)

		if count > 0 {
			result = append(result, CellSnapshot{
				H3Index:   h3Index,
				Intensity: count,
			})
		}

		return true // continue iteration
	})

	return result
}

// TotalActive returns the number of H3 cells that have non-zero counters.
// This is a rough estimate (not atomically consistent across all cells).
func (a *Aggregator) TotalActive() int {
	count := 0
	a.cells.Range(func(_, value any) bool {
		counter := value.(*uint64)
		if atomic.LoadUint64(counter) > 0 {
			count++
		}
		return true
	})
	return count
}
