import os
import math
import httpx
import asyncpg
from datetime import datetime, timezone
from typing import Optional
from models import TelemetryEvidence

POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://heatmap:heatmap_secret_2024@localhost:5432/heatmap_db")

# Tier 3 Default Widths by Road Class (in meters, based on National Highway Capacity Standards)
DEFAULT_ROAD_WIDTHS = {
    "motorway": 21.0,     # 6 lanes
    "trunk": 21.0,        # 6 lanes
    "primary": 14.0,      # 4 lanes
    "secondary": 7.0,     # 2 lanes
    "tertiary": 7.0,      # 2 lanes
    "unclassified": 6.0,  # 2 narrow lanes
    "residential": 4.0,   # 1-2 narrow lanes
    "living_street": 3.5, # 1 lane
    "service": 3.5,       # 1 lane
}

# Legal speed limits by road class (in km/h)
LEGAL_MAXSPEEDS = {
    "motorway": 90.0,
    "trunk": 80.0,
    "primary": 60.0,
    "secondary": 50.0,
    "tertiary": 50.0,
    "unclassified": 40.0,
    "residential": 30.0,
    "living_street": 20.0,
    "service": 20.0,
}

OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"

async def fetch_road_class_threshold(lat: float, lng: float) -> tuple[float, str]:
    """
    Compute dynamic deviation threshold (in meters) using the Scientific AASHTO / HMM Formula:
    Threshold = Max(20.0, (Road Width / 2.0) + (Official Maxspeed * 1.2))
    
    Road Width is determined via 3-Tier Verification Engine:
    - Tier 1: Direct 'width' tag from OpenStreetMap (e.g. width=20m)
    - Tier 2: Calculated from 'lanes' tag (lanes * 3.5m)
    - Tier 3: National Highway Capacity Manual standards by road class
    
    Official Maxspeed is determined via:
    - Direct 'maxspeed' tag from OpenStreetMap (e.g. maxspeed=50)
    - National Legal Speed Limit Matrix by road class
    """
    if not lat or not lng:
        return 74.0, "urban_road"

    query = f"""
    [out:json][timeout:2];
    way(around:20,{lat},{lng})[highway];
    out tags;
    """

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.post(OVERPASS_API_URL, data={"data": query})
            if resp.status_code == 200:
                data = resp.json()
                elements = data.get("elements", [])
                if elements:
                    tags = elements[0].get("tags", {})
                    highway_tag = tags.get("highway", "secondary")

                    # 1. Determine Road Width (3-Tier Engine)
                    width_m = None
                    width_tag = tags.get("width", "")
                    if width_tag:
                        clean_w = "".join([c for c in width_tag if c.isdigit() or c == "."])
                        if clean_w:
                            try:
                                width_m = float(clean_w)
                            except ValueError:
                                pass

                    if width_m is None:
                        lanes_tag = tags.get("lanes", "")
                        if lanes_tag and lanes_tag.isdigit():
                            width_m = float(lanes_tag) * 3.5
                        else:
                            width_m = DEFAULT_ROAD_WIDTHS.get(highway_tag, 7.0)

                    # 2. Determine Official Maxspeed
                    maxspeed_kmh = None
                    maxspeed_tag = tags.get("maxspeed", "")
                    if maxspeed_tag:
                        clean_s = "".join([c for c in maxspeed_tag if c.isdigit()])
                        if clean_s:
                            try:
                                maxspeed_kmh = float(clean_s)
                            except ValueError:
                                pass

                    if maxspeed_kmh is None:
                        maxspeed_kmh = LEGAL_MAXSPEEDS.get(highway_tag, 50.0)

                    # 3. Scientific AASHTO Dynamic Threshold Formula
                    threshold = max(20.0, (width_m / 2.0) + (maxspeed_kmh * 1.2))
                    return round(threshold, 1), highway_tag
    except Exception as e:
        print(f"[Tool: Telemetry Road Class Threshold Fallback] {e}")

    return 74.0, "urban_road"

def compute_wilson_interval(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
    """
    Compute 95% Wilson Score Interval for binomial proportion:
    Returns (lower_bound, upper_bound, margin_of_error)
    """
    if n <= 0:
        return 0.0, 1.0, 0.5

    p_hat = float(k) / float(n)
    num = p_hat + (z**2) / (2 * n)
    adj_z = z * math.sqrt((p_hat * (1.0 - p_hat) + (z**2) / (4.0 * n)) / n)
    denom = 1.0 + (z**2) / n

    lower = max(0.0, (num - adj_z) / denom)
    upper = min(1.0, (num + adj_z) / denom)
    margin = (upper - lower) / 2.0

    return round(lower, 3), round(upper, 3), round(margin, 3)

def compute_bayesian_smoothed_ratio(k: int, n: int, p0: float = 0.05, c: float = 10.0) -> float:
    """
    Compute Bayesian smoothed deviation ratio:
    Adjusted Ratio = (high_dev_trips + C * P0) / (unique_trips + C)
    Eliminates false-positive 100% spikes when N < 5.
    """
    adjusted = (float(k) + (c * p0)) / (float(n) + c)
    return round(adjusted, 3)

async def query_telemetry(
    h3_index: str, lat: float, lng: float, time_window_minutes: int = 0, timestamp_ms: Optional[int] = None
) -> TelemetryEvidence:
    """
    Query PostgreSQL/PostGIS for exact deviation telemetry of all drivers in the H3 cell or vicinity.
    Uses Scientific 3-Tier Road Width Engine, AASHTO Threshold Formula, Bayesian Smoothing, and 95% Wilson Confidence Bounds.
    """
    delta_lat = 0.0015
    delta_lng = 0.0015
    min_lat, max_lat = lat - delta_lat, lat + delta_lat
    min_lng, max_lng = lng - delta_lng, lng + delta_lng

    # Fetch dynamic deviation threshold using Scientific 3-Tier Road Width Engine
    threshold_m, _ = await fetch_road_class_threshold(lat, lng)

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
                COUNT(DISTINCT CASE WHEN deviation_meters > $7 THEN trip_id END)::INT AS high_dev_trips,
                COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 0)::FLOAT8 AS avg_speed
            FROM deviation_events
            WHERE (h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5))
              AND created_at BETWEEN ($6::TIMESTAMPTZ - INTERVAL '24 hours') AND ($6::TIMESTAMPTZ + INTERVAL '24 hours');
        """
        try:
            conn = await asyncpg.connect(POSTGRES_DSN, timeout=3.0)
            try:
                row = await conn.fetchrow(query_timestamp, h3_index, min_lat, max_lat, min_lng, max_lng, dt, threshold_m)
                if row and (row["total_events"] or 0) > 0:
                    unique_trips = row["unique_trips"] or 0
                    high_dev_trips = row["high_dev_trips"] or 0
                    raw_ratio = float(high_dev_trips) / float(unique_trips) if unique_trips > 0 else 0.0

                    adj_ratio = compute_bayesian_smoothed_ratio(high_dev_trips, unique_trips)
                    lower_w, upper_w, margin_w = compute_wilson_interval(high_dev_trips, unique_trips)

                    return TelemetryEvidence(
                        total_events=row["total_events"] or 0,
                        unique_drivers=row["unique_drivers"] or 0,
                        unique_trips=unique_trips,
                        high_dev_trips=high_dev_trips,
                        fleet_deviation_ratio=round(raw_ratio, 3),
                        adjusted_deviation_ratio=adj_ratio,
                        wilson_lower_bound=lower_w,
                        wilson_upper_bound=upper_w,
                        margin_of_error=margin_w,
                        dynamic_threshold_m=threshold_m,
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
            COUNT(DISTINCT CASE WHEN deviation_meters > $7 THEN trip_id END)::INT AS high_dev_trips,
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
            COUNT(DISTINCT CASE WHEN deviation_meters > $6 THEN trip_id END)::INT AS high_dev_trips,
            COALESCE(ROUND(AVG(speed_kmh)::NUMERIC, 1), 0)::FLOAT8 AS avg_speed
        FROM deviation_events
        WHERE (h3_index = $1 OR (latitude BETWEEN $2 AND $3 AND longitude BETWEEN $4 AND $5));
    """

    try:
        conn = await asyncpg.connect(POSTGRES_DSN, timeout=3.0)
        try:
            row = None
            if time_window_minutes > 0:
                row = await conn.fetchrow(query_with_time, h3_index, min_lat, max_lat, min_lng, max_lng, str(time_window_minutes), threshold_m)

            if not row or (row["total_events"] or 0) == 0:
                row = await conn.fetchrow(query_all_history, h3_index, min_lat, max_lat, min_lng, max_lng, threshold_m)

            if row and (row["total_events"] or 0) > 0:
                unique_trips = row["unique_trips"] or 0
                high_dev_trips = row["high_dev_trips"] or 0
                raw_ratio = float(high_dev_trips) / float(unique_trips) if unique_trips > 0 else 0.0

                adj_ratio = compute_bayesian_smoothed_ratio(high_dev_trips, unique_trips)
                lower_w, upper_w, margin_w = compute_wilson_interval(high_dev_trips, unique_trips)

                return TelemetryEvidence(
                    total_events=row["total_events"] or 0,
                    unique_drivers=row["unique_drivers"] or 0,
                    unique_trips=unique_trips,
                    high_dev_trips=high_dev_trips,
                    fleet_deviation_ratio=round(raw_ratio, 3),
                    adjusted_deviation_ratio=adj_ratio,
                    wilson_lower_bound=lower_w,
                    wilson_upper_bound=upper_w,
                    margin_of_error=margin_w,
                    dynamic_threshold_m=threshold_m,
                    avg_speed_kmh=row["avg_speed"] or 0.0,
                    avg_deviation_m=row["avg_deviation"] or 0.0,
                )
        finally:
            await conn.close()
    except Exception as e:
        print(f"[Tool: DB Telemetry Error] {e}")

    return TelemetryEvidence(dynamic_threshold_m=threshold_m)
