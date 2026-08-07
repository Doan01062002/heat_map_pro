import os
import asyncpg
from typing import Optional
from models import TrafficSpeedEvidence

POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://heatmap:heatmap_secret_2024@localhost:5432/heatmap_db")

async def analyze_traffic_speed(
    h3_index: str, current_avg_speed: float, lat: float = 0.0, lng: float = 0.0
) -> TrafficSpeedEvidence:
    """
    Compare current fleet average speed vs historical baseline speed for the H3 cell or 300m vicinity.
    Handles N=1 single deviation trip edge cases by expanding spatial bounding box radius (~300m)
    or falling back to road-class default baseline speed (35-45 km/h).
    100% Free, internal PostGIS query.
    Timeout: 3 seconds.
    """
    delta = 0.003  # ~300m radius
    min_lat, max_lat = lat - delta, lat + delta
    min_lng, max_lng = lng - delta, lng + delta

    # Spatial query for cell OR 300m vicinity to ensure robust baseline even if N=1 for single cell
    query_baseline = """
        SELECT
            COUNT(*)::INT AS sample_count,
            COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 35.0)::FLOAT8 AS baseline_speed
        FROM deviation_events
        WHERE (h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5))
          AND speed_kmh > 5.0;
    """

    try:
        conn = await asyncpg.connect(POSTGRES_DSN, timeout=3.0)
        try:
            row = await conn.fetchrow(query_baseline, h3_index, min_lat, max_lat, min_lng, max_lng)
            sample_count = row["sample_count"] if row else 0

            # If sample count < 3 (N=1 single trip edge case), fallback to standard urban baseline (35.0 km/h)
            if not row or sample_count < 3:
                baseline = 35.0
            else:
                baseline = row["baseline_speed"] if row["baseline_speed"] > 0 else 35.0

            curr_speed = current_avg_speed if current_avg_speed > 0 else baseline
            speed_ratio = curr_speed / baseline if baseline > 0 else 1.0
            speed_drop = max(0.0, 1.0 - speed_ratio)

            if speed_drop >= 0.65:
                state = "SEVERE_GRIDLOCK"
            elif speed_drop >= 0.35:
                state = "MODERATE_SLOW"
            else:
                state = "CLEAR"

            return TrafficSpeedEvidence(
                baseline_speed_kmh=round(baseline, 1),
                current_speed_kmh=round(curr_speed, 1),
                speed_drop_ratio=round(speed_drop, 3),
                traffic_state=state,
            )
        finally:
            await conn.close()
    except Exception as e:
        print(f"[Tool: Traffic Speed Error] {e}")

    return TrafficSpeedEvidence(
        baseline_speed_kmh=35.0,
        current_speed_kmh=round(current_avg_speed if current_avg_speed > 0 else 35.0, 1),
        speed_drop_ratio=0.0,
        traffic_state="CLEAR",
    )
