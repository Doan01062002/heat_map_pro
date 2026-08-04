// Package persistence — adapter to satisfy ingestion.EventPersister interface.
package persistence

import (
	"time"

	"github.com/heat-map-pro/backend/internal/ingestion"
)

// Adapter wraps PostgresWriter to satisfy the ingestion.EventPersister interface.
// This avoids an import cycle between ingestion and persistence.
type Adapter struct {
	writer *PostgresWriter
}

// NewAdapter creates a new persistence adapter.
func NewAdapter(w *PostgresWriter) *Adapter {
	return &Adapter{writer: w}
}

// BufferEvent implements ingestion.EventPersister by converting
// the ingestion event data to a persistence DeviationEvent and buffering it.
func (a *Adapter) BufferEvent(event ingestion.DeviationEventData) {
	a.writer.BufferEvent(DeviationEvent{
		DriverID:        event.DriverID,
		TripID:          event.TripID,
		Latitude:        event.Latitude,
		Longitude:       event.Longitude,
		H3Index:         event.H3Index,
		DeviationMeters: event.DeviationMeters,
		Heading:         event.Heading,
		SpeedKmh:        event.SpeedKmh,
		Timestamp:       time.Now(),
	})
}
