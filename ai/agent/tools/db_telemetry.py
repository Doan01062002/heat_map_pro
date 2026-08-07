import os
import asyncpg
from datetime import datetime, timezone
from typing import Optional
from models import TelemetryEvidence

POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://heatmap:heatmap_secret_2024@localhost:5432/heatmap_db")

async def query_telemetry(h3_index: str, lat: float, lng: float, time_window_minutes: int = 0, timestamp_ms: Optional[int] = None) -> TelemetryEvidence:
    """
    Query PostgreSQL/PostGIS for exact deviation telemetry of all drivers in the H3 cell or vicinity.
    Supports querying historical timestamps if timestamp_ms is provided.
    """
    delta_lat = 0.0015
    delta_lng = 0.0015
    min_lat, max_lat = lat - delta_lat, lat + delta_lat
    min_lng, max_lng = lng - delta_lng, lng + delta_lng

    # 1. Query with specific timestamp window if timestamp_ms is provided
    if timestamp_ms and timestamp_ms > 0:
        dt = datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
        query_timestamp = """
            SELECT
                COUNT(*)::INT AS total_events,
                COUNT(DISTINCT driver_id)::INT AS unique_drivers,
                COUNT(DISTINCT trip_id)::INT AS unique_trips,
                COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS avg_deviation,
                COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS max_deviation,
                COUNT(DISTINCT CASE WHEN deviation_meters > 150 THEN trip_id END)::INT AS high_dev_trips,
                COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 0)::FLOAT8 AS avg_speed
            FROM deviation_events
            WHERE (h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5))
              AND created_at BETWEEN ($6::TIMESTAMPTZ - INTERVAL '24 hours') AND ($6::TIMESTAMPTZ + INTERVAL '24 hours');
        """
        try:
            conn = await asyncpg.connect(POSTGRES_DSN, timeout=3.0)
            try:
                row = await conn.fetchrow(query_timestamp, h3_index, min_lat, max_lat, min_lng, max_lng, dt)
                if row and (row["total_events"] or 0) > 0:
                    unique_trips = row["unique_trips"] or 0
                    high_dev_trips = row["high_dev_trips"] or 0
                    ratio = float(high_dev_trips) / float(unique_trips) if unique_trips > 0 else 0.0

                    return TelemetryEvidence(
                        total_events=row["total_events"] or 0,
                        unique_drivers=row["unique_drivers"] or 0,
                        unique_trips=unique_trips,
                        high_dev_trips=high_dev_trips,
                        fleet_deviation_ratio=round(ratio, 3),
                        avg_speed_kmh=row["avg_speed"] or 0.0,
                        avg_deviation_m=row["avg_deviation"] or 0.0,
                    )
            finally:
                await conn.close()
        except Exception as e:
            print(f"[Tool: DB Telemetry Timestamp Error] {e}")

    # 2. Query with time_window_minutes if > 0 (Live mode)
    query_with_time = """
        SELECT
            COUNT(*)::INT AS total_events,
            COUNT(DISTINCT driver_id)::INT AS unique_drivers,
            COUNT(DISTINCT trip_id)::INT AS unique_trips,
            COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS avg_deviation,
            COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS max_deviation,
            COUNT(DISTINCT CASE WHEN deviation_meters > 150 THEN trip_id END)::INT AS high_dev_trips,
            COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 0)::FLOAT8 AS avg_speed
        FROM deviation_events
        WHERE (h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5))
          AND created_at >= NOW() - ($6 || ' minutes')::INTERVAL;
    """

    # 3. Query full history for the cell/location
    query_all_history = """
        SELECT
            COUNT(*)::INT AS total_events,
            COUNT(DISTINCT driver_id)::INT AS unique_drivers,
            COUNT(DISTINCT trip_id)::INT AS unique_trips,
            COALESCE(ROUND(AVG(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS avg_deviation,
            COALESCE(ROUND(MAX(deviation_meters)::NUMERIC, 1), 0)::FLOAT8 AS max_deviation,
            COUNT(DISTINCT CASE WHEN deviation_meters > 150 THEN trip_id END)::INT AS high_dev_trips,
            COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 0)::FLOAT8 AS avg_speed
        FROM deviation_events
        WHERE h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5);
    """

    try:
        conn = await asyncpg.connect(POSTGRES_DSN, timeout=3.0)
        try:
            row = None
            if time_window_minutes > 0:
                row = await conn.fetchrow(query_with_time, h3_index, min_lat, max_lat, min_lng, max_lng, str(time_window_minutes))

            if not row or (row["total_events"] or 0) == 0:
                row = await conn.fetchrow(query_all_history, h3_index, min_lat, max_lat, min_lng, max_lng)

            if row and (row["total_events"] or 0) > 0:
                unique_trips = row["unique_trips"] or 0
                high_dev_trips = row["high_dev_trips"] or 0
                ratio = float(high_dev_trips) / float(unique_trips) if unique_trips > 0 else 0.0

                return TelemetryEvidence(
                    total_events=row["total_events"] or 0,
                    unique_drivers=row["unique_drivers"] or 0,
                    unique_trips=unique_trips,
                    high_dev_trips=high_dev_trips,
                    fleet_deviation_ratio=round(ratio, 3),
                    avg_speed_kmh=row["avg_speed"] or 0.0,
                    avg_deviation_m=row["avg_deviation"] or 0.0,
                )
        finally:
            await conn.close()
    except Exception as e:
        print(f"[Tool: DB Telemetry Error] {e}")

    return TelemetryEvidence()
