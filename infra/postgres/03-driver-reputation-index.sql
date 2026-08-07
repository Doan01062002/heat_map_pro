-- Migration 03: Composite B-Tree Index for Ultra-Fast 30-Day Driver Reputation & Cell Compliance Queries

CREATE INDEX IF NOT EXISTS idx_deviation_driver_created 
ON deviation_events (driver_id, created_at) 
INCLUDE (deviation_meters, trip_id);

CREATE INDEX IF NOT EXISTS idx_deviation_h3_created 
ON deviation_events (h3_index, created_at) 
INCLUDE (driver_id, deviation_meters, trip_id);
