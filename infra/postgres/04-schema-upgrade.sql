-- ==============================================================================
-- Migration 04: Schema Upgrade — event_type, planned_route, PostGIS geometry
-- ==============================================================================
-- Summary of changes:
--   1. deviation_events: add event_type to distinguish "deviation" points (driver
--      left the OSRM route) from "actual_path" points (the road the driver chose
--      instead of the OSRM suggestion).
--   2. trips: add planned_route_json (OSRM suggested polyline) + deviation_ratio
--      (fraction of route that deviated).
--   3. Add PostGIS geometry column + GIST index to deviation_events so that
--      road-stats queries can use ST_DWithin() instead of Haversine full-scans.
-- ==============================================================================

-- ── 1. deviation_events: event_type column ─────────────────────────────────
-- Values:
--   'deviation'    — GPS point confirmed > 50m from planned OSRM route
--   'actual_path'  — GPS point that is part of the road the driver chose
--                    when deviating (the alternative path, not planned).
ALTER TABLE deviation_events
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(20) NOT NULL DEFAULT 'deviation';

-- Index for filtering by event type (used by /api/actual-path)
CREATE INDEX IF NOT EXISTS idx_deviation_events_type_h3_time
  ON deviation_events (event_type, h3_index, created_at DESC);

-- ── 2. trips: planned_route_json + deviation_ratio ─────────────────────────
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS planned_route_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS deviation_ratio    REAL  NOT NULL DEFAULT 0.0;
-- deviation_ratio ∈ [0.0, 1.0]: fraction of actual route that is > 50m from
-- the OSRM planned route. 0 = fully on-route, 1 = entirely off-route.

-- ── 3. PostGIS geometry column for fast spatial queries ────────────────────
-- Adds a geography(Point, 4326) column so ST_DWithin() can use a GIST index
-- (O(log n)) instead of the current Haversine acos formula (O(n) full scan).

ALTER TABLE deviation_events
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

-- Back-fill existing rows from latitude/longitude columns
UPDATE deviation_events
  SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
  WHERE geog IS NULL;

-- GIST spatial index — used by HandleRoadStatsQuery ST_DWithin()
CREATE INDEX IF NOT EXISTS idx_deviation_events_geog
  ON deviation_events USING GIST (geog);

-- Trigger to keep geog in sync with lat/lng on future inserts
CREATE OR REPLACE FUNCTION sync_deviation_geog()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.geog := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_deviation_geog ON deviation_events;
CREATE TRIGGER trg_sync_deviation_geog
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON deviation_events
  FOR EACH ROW EXECUTE FUNCTION sync_deviation_geog();

-- ── 4. Updated heatmap_summary view (only deviation events) ────────────────
-- Re-create the view to exclude 'actual_path' points from the deviation heatmap.
CREATE OR REPLACE VIEW heatmap_summary AS
SELECT
    h3_index,
    COUNT(*)::INTEGER          AS intensity,
    MAX(created_at)            AS last_updated,
    COUNT(DISTINCT driver_id)  AS unique_drivers
FROM deviation_events
WHERE event_type = 'deviation'
GROUP BY h3_index;

-- ── 5. New view: actual_path_summary (for the "Hex Tài Xế Đi" layer) ───────
CREATE OR REPLACE VIEW actual_path_summary AS
SELECT
    h3_index,
    COUNT(*)::INTEGER          AS intensity,
    MAX(created_at)            AS last_updated,
    COUNT(DISTINCT driver_id)  AS unique_drivers,
    COUNT(DISTINCT trip_id)    AS unique_trips
FROM deviation_events
WHERE event_type = 'actual_path'
GROUP BY h3_index;

-- ── 6. Updated get_heatmap_for_period (filter to deviation only) ────────────
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
        COUNT(*)::INTEGER                     AS intensity,
        MAX(de.created_at)                    AS last_updated,
        COUNT(DISTINCT de.driver_id)::INTEGER AS unique_drivers
    FROM deviation_events de
    WHERE de.created_at >= p_from
      AND de.created_at <= p_to
      AND de.event_type = 'deviation'
    GROUP BY de.h3_index
    ORDER BY intensity DESC;
$$;
