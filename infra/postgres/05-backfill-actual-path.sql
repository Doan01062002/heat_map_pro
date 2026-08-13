-- ==============================================================================
-- Migration 05: Backfill actual_path events from historical trips
-- ==============================================================================
-- Purpose:
--   The "Hex Tài Xế Đi" layer in the Admin Dashboard queries
--   deviation_events WHERE event_type = 'actual_path'.
--   These events are only written at trip-save time from the Simulator.
--   For trips already stored in the 'trips' table (historical/Porto data),
--   no actual_path rows exist yet → layer shows empty.
--
--   This script backfills actual_path rows by unpacking each trip's
--   actual_route_json coordinate array and inserting one deviation_event
--   row per GPS point, tagged event_type='actual_path'.
--
-- Safe to run multiple times: ON CONFLICT (trip_id, event_type, latitude, longitude)
-- will silently skip duplicates.
--
-- Run ONCE against your live PostgreSQL instance:
--   docker exec -i <postgres_container> psql -U heatmap -d heatmap -f /path/to/05-backfill-actual-path.sql
-- ==============================================================================

BEGIN;

-- ── Step 1: Unique partial index to make backfill idempotent ─────────────────
-- Prevents duplicate inserts if this script is re-run.
-- Only index actual_path events to avoid touching the much larger deviation set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_actual_path_dedup
  ON deviation_events (trip_id, event_type, latitude, longitude)
  WHERE event_type = 'actual_path';

-- ── Step 2: Backfill via PL/pgSQL ─────────────────────────────────────────────
DO $$
DECLARE
  rec          RECORD;
  coord        JSONB;
  pt_lat       DOUBLE PRECISION;
  pt_lng       DOUBLE PRECISION;
  pt_idx       INTEGER;
  approx_h3    VARCHAR(20);
  inserted_cnt BIGINT := 0;
  skipped_cnt  BIGINT := 0;
  trip_cnt     INTEGER := 0;
BEGIN
  RAISE NOTICE '[backfill] Starting actual_path backfill from trips table...';

  FOR rec IN
    SELECT
      t.trip_id,
      t.driver_id,
      t.actual_route_json,
      COALESCE(t.created_at, NOW()) AS trip_time
    FROM trips t
    WHERE jsonb_array_length(t.actual_route_json) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM deviation_events de
      WHERE de.trip_id = t.trip_id
        AND de.event_type = 'actual_path'
      LIMIT 1
    )
    ORDER BY t.created_at ASC
  LOOP
    trip_cnt := trip_cnt + 1;
    pt_idx   := 0;

    FOR coord IN SELECT * FROM jsonb_array_elements(rec.actual_route_json)
    LOOP
      -- actual_route_json stores [lng, lat] pairs (GeoJSON convention)
      pt_lng := (coord->0)::DOUBLE PRECISION;
      pt_lat := (coord->1)::DOUBLE PRECISION;

      -- Validate coordinate range
      IF pt_lat IS NULL OR pt_lng IS NULL
         OR pt_lat < -90  OR pt_lat > 90
         OR pt_lng < -180 OR pt_lng > 180 THEN
        CONTINUE;
      END IF;

      -- Approximate H3-like index key from truncated lat/lng grid (res ~460m)
      -- Frontend renders exact hex boundaries client-side via h3-js
      approx_h3 := 'r8_' ||
        LPAD(((pt_lat + 90) * 100)::INTEGER::TEXT, 5, '0') || '_' ||
        LPAD(((pt_lng + 180) * 100)::INTEGER::TEXT, 6, '0');

      BEGIN
        INSERT INTO deviation_events (
          driver_id, trip_id,
          latitude, longitude,
          h3_index,
          deviation_meters,
          heading, speed_kmh,
          created_at,
          event_type
        ) VALUES (
          rec.driver_id,
          rec.trip_id,
          pt_lat,
          pt_lng,
          approx_h3,
          0.0,
          90,
          40,
          rec.trip_time + (pt_idx || ' seconds')::INTERVAL,
          'actual_path'
        )
        ON CONFLICT (trip_id, event_type, latitude, longitude) DO NOTHING;

        inserted_cnt := inserted_cnt + 1;
      EXCEPTION WHEN OTHERS THEN
        skipped_cnt := skipped_cnt + 1;
      END;

      pt_idx := pt_idx + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE '[backfill] Done. Trips processed: %, Points inserted: %, Skipped: %',
    trip_cnt, inserted_cnt, skipped_cnt;
END;
$$;

-- ── Step 3: Back-fill PostGIS geog column for newly inserted rows ─────────────
UPDATE deviation_events
  SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE geog IS NULL
  AND event_type = 'actual_path';

-- ── Step 4: Verify results ─────────────────────────────────────────────────────
SELECT
  'actual_path events backfilled' AS status,
  COUNT(*)                        AS total_rows,
  COUNT(DISTINCT trip_id)         AS unique_trips,
  COUNT(DISTINCT driver_id)       AS unique_drivers
FROM deviation_events
WHERE event_type = 'actual_path';

COMMIT;
