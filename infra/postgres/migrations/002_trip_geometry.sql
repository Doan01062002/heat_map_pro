-- ==============================================================================
-- Migration 002: Trip Geometry + Fréchet/Hausdorff Metrics
-- ==============================================================================
-- Adds PostGIS geometry columns to the trips table for computing
-- Fréchet and Hausdorff distances between planned and actual routes.
-- ==============================================================================

-- Geometry columns for planned and actual routes
ALTER TABLE trips ADD COLUMN IF NOT EXISTS planned_geom geometry(LineString, 4326);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_geom geometry(LineString, 4326);

-- Pre-computed distance metrics (updated when trip completes)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS frechet_distance DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS hausdorff_distance DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS planned_length_km DOUBLE PRECISION;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS actual_length_km DOUBLE PRECISION;

-- Spatial index on actual route for proximity queries
CREATE INDEX IF NOT EXISTS idx_trips_actual_geom ON trips USING GIST (actual_geom);
CREATE INDEX IF NOT EXISTS idx_trips_planned_geom ON trips USING GIST (planned_geom);

-- ==============================================================================
-- Lixel Binning: Add way_name to deviation_events
-- ==============================================================================
ALTER TABLE deviation_events ADD COLUMN IF NOT EXISTS way_name VARCHAR(256) DEFAULT '';

-- Index for road-name-based aggregation queries (GROUP BY way_name)
CREATE INDEX IF NOT EXISTS idx_deviation_events_way_name
    ON deviation_events (way_name)
    WHERE way_name != '';
