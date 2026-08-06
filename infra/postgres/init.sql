-- ==============================================================================
-- PostgreSQL + PostGIS Initialization Script
-- ==============================================================================
-- This script runs ONCE when the PostgreSQL container starts for the first time.
-- It creates the PostGIS extension and all required tables.
-- ==============================================================================

-- Enable PostGIS spatial extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ==============================================================================
-- Table: deviation_events
-- ==============================================================================
-- Stores individual deviation events for historical analysis.
-- Each row = one GPS point that was confirmed as a deviation (>50m from route).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS deviation_events (
    id              BIGSERIAL       PRIMARY KEY,
    driver_id       VARCHAR(64)     NOT NULL,
    trip_id         VARCHAR(128)    NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    h3_index        VARCHAR(20)     NOT NULL,
    deviation_meters DOUBLE PRECISION NOT NULL,
    heading         REAL            DEFAULT 0,
    speed_kmh       REAL            DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Index for time-range queries (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_deviation_events_created_at
    ON deviation_events (created_at DESC);

-- Index for H3 cell aggregation queries
CREATE INDEX IF NOT EXISTS idx_deviation_events_h3_index
    ON deviation_events (h3_index);

-- Index for driver-specific queries
CREATE INDEX IF NOT EXISTS idx_deviation_events_driver_id
    ON deviation_events (driver_id, created_at DESC);

-- Composite index for the most common admin query:
-- "Show me deviation counts per H3 cell in the last N minutes"
CREATE INDEX IF NOT EXISTS idx_deviation_events_h3_time
    ON deviation_events (h3_index, created_at DESC);

-- ==============================================================================
-- Table: trips
-- ==============================================================================
-- Stores registered trip routes with their bounding boxes.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS trips (
    trip_id         VARCHAR(128)    PRIMARY KEY,
    driver_id       VARCHAR(64)     NOT NULL,
    bbox_min_lat    DOUBLE PRECISION DEFAULT 0,
    bbox_min_lng    DOUBLE PRECISION DEFAULT 0,
    bbox_max_lat    DOUBLE PRECISION DEFAULT 0,
    bbox_max_lng    DOUBLE PRECISION DEFAULT 0,
    origin_json     JSONB           NOT NULL DEFAULT '{}'::jsonb,
    destination_json JSONB          NOT NULL DEFAULT '{}'::jsonb,
    waypoints_json  JSONB           NOT NULL DEFAULT '[]'::jsonb,
    actual_route_json JSONB         NOT NULL DEFAULT '[]'::jsonb,
    distance_km     DOUBLE PRECISION DEFAULT 0,
    duration_min    INTEGER         DEFAULT 0,
    is_deviated     BOOLEAN         DEFAULT false,
    status          VARCHAR(20)     NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trips_driver_id
    ON trips (driver_id);

CREATE INDEX IF NOT EXISTS idx_trips_status
    ON trips (status) WHERE status = 'active';

-- ==============================================================================
-- View: heatmap_summary
-- ==============================================================================
-- Pre-built view for common dashboard query:
-- "Aggregate deviation intensity per H3 cell for a given time window"
-- ==============================================================================
CREATE OR REPLACE VIEW heatmap_summary AS
SELECT
    h3_index,
    COUNT(*)::INTEGER          AS intensity,
    MAX(created_at)            AS last_updated,
    COUNT(DISTINCT driver_id)  AS unique_drivers
FROM deviation_events
GROUP BY h3_index;

-- ==============================================================================
-- Function: get_heatmap_for_period
-- ==============================================================================
-- Returns aggregated H3 cell data for a specific time range.
-- Used by: GET /api/history?from=...&to=...
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_heatmap_for_period(
    p_from TIMESTAMPTZ,
    p_to   TIMESTAMPTZ
)
RETURNS TABLE (
    h3_index       VARCHAR(20),
    intensity      INTEGER,
    last_updated   TIMESTAMPTZ,
    unique_drivers INTEGER
)
LANGUAGE SQL STABLE
AS $$
    SELECT
        de.h3_index,
        COUNT(*)::INTEGER          AS intensity,
        MAX(de.created_at)         AS last_updated,
        COUNT(DISTINCT de.driver_id)::INTEGER AS unique_drivers
    FROM deviation_events de
    WHERE de.created_at >= p_from
      AND de.created_at <= p_to
    GROUP BY de.h3_index
    ORDER BY intensity DESC;
$$;

-- ==============================================================================
-- Table: drivers
-- ==============================================================================
-- Stores driver accounts for authentication & profile management.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS drivers (
    id              BIGSERIAL       PRIMARY KEY,
    driver_id       VARCHAR(64)     UNIQUE NOT NULL,
    email           VARCHAR(128)    UNIQUE NOT NULL,
    password_hash   VARCHAR(255)    NOT NULL,
    full_name       VARCHAR(128)    NOT NULL,
    phone           VARCHAR(32),
    license_plate   VARCHAR(32),
    vehicle_type    VARCHAR(32)     DEFAULT 'taxi',
    status          VARCHAR(20)     NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email);
CREATE INDEX IF NOT EXISTS idx_drivers_driver_id ON drivers(driver_id);

