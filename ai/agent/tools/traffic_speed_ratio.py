import os
import httpx
import asyncpg
from typing import Optional
from datetime import datetime, timezone
from models import TrafficSpeedEvidence

# Traffic Laws & OpenStreetMap Road Class speed limit matrix (km/h)
ROAD_CLASS_SPEED_LIMITS = {
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
PRIMARY_OSRM_URL = os.getenv("OSRM_URL", "http://osrm:5000")
POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://heatmap:heatmap_secret_2024@localhost:5432/heatmap_db")

# LRU Cache to eliminate Overpass latency & rate-limit bottlenecks
_SPEED_LIMIT_CACHE: dict[tuple[float, float], tuple[float, str, bool]] = {}
MAX_CACHE_SIZE = 2000

async def fetch_authoritative_road_limit_and_signal(lat: float, lng: float) -> tuple[float, str, bool]:
    """
    Fetch exact official speed limit, road name, and traffic signal/intersection presence
    within 35 meters using OpenStreetMap Overpass & Local Cache.
    Returns: (speed_limit_kmh, road_name, is_traffic_signal_intersection)
    """
    if not lat or not lng:
        return 40.0, "urban_road", False

    cache_key = (round(lat, 4), round(lng, 4))
    if cache_key in _SPEED_LIMIT_CACHE:
        return _SPEED_LIMIT_CACHE[cache_key]

    # Query Overpass for ways AND traffic signal nodes within 35 meters
    query = f"""
    [out:json][timeout:3];
    (
      way(around:35,{lat},{lng})[highway];
      node(around:35,{lat},{lng})[highway=traffic_signals];
      node(around:35,{lat},{lng})[highway=stop];
    );
    out tags;
    """

    speed_limit = 40.0
    road_name = "urban_road"
    is_signal = False

    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            resp = await client.post(OVERPASS_API_URL, data={"data": query})
            if resp.status_code == 200:
                data = resp.json()
                elements = data.get("elements", [])
                for elem in elements:
                    tags = elem.get("tags", {})
                    # Check if signal/stop node exists
                    if tags.get("highway") in ["traffic_signals", "stop"]:
                        is_signal = True

                    if elem.get("type") == "way":
                        maxspeed_tag = tags.get("maxspeed", "")
                        highway_tag = tags.get("highway", "secondary")
                        road_name = tags.get("name", highway_tag)

                        if maxspeed_tag:
                            clean_speed = "".join([c for c in maxspeed_tag if c.isdigit()])
                            if clean_speed:
                                speed_limit = float(clean_speed)
                        else:
                            speed_limit = ROAD_CLASS_SPEED_LIMITS.get(highway_tag, 40.0)
    except Exception as e:
        print(f"[Tool: Overpass Traffic Speed Fallback] {e}")

    result = (speed_limit, road_name, is_signal)

    if len(_SPEED_LIMIT_CACHE) < MAX_CACHE_SIZE:
        _SPEED_LIMIT_CACHE[cache_key] = result

    return result

async def check_post_intersection_clearance_speed(lat: float, lng: float, timestamp_ms: Optional[int] = None) -> float:
    """
    Multi-Phase Signal Clearance Trajectory Check:
    Queries Postgres for peak moving speed of vehicles in this vicinity.
    For historical data, queries within ±5 minutes of the given timestamp.
    For real-time data, queries last 5 minutes from NOW().
    If peak clearance speed >= 50% of speed limit, the vehicle was waiting for a red light!
    """
    delta = 0.003
    if timestamp_ms and timestamp_ms > 0:
        dt = datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
        query = """
            SELECT COALESCE(MAX(speed_kmh), 0.0)::FLOAT8 AS peak_clearance_speed
            FROM deviation_events
            WHERE (latitude BETWEEN $1 AND $2) AND (longitude BETWEEN $3 AND $4)
              AND speed_kmh > 0
              AND created_at BETWEEN ($5::TIMESTAMPTZ - INTERVAL '5 minutes') AND ($5::TIMESTAMPTZ + INTERVAL '5 minutes');
        """
        try:
            conn = await asyncpg.connect(POSTGRES_DSN, timeout=2.0)
            try:
                row = await conn.fetchrow(query, lat - delta, lat + delta, lng - delta, lng + delta, dt)
                if row and row["peak_clearance_speed"]:
                    return float(row["peak_clearance_speed"])
            finally:
                await conn.close()
        except Exception:
            pass
        return 0.0

    query = """
        SELECT COALESCE(MAX(speed_kmh), 0.0)::FLOAT8 AS peak_clearance_speed
        FROM deviation_events
        WHERE (latitude BETWEEN $1 AND $2) AND (longitude BETWEEN $3 AND $4)
          AND speed_kmh > 0
          AND created_at >= NOW() - INTERVAL '5 minutes';
    """
    try:
        conn = await asyncpg.connect(POSTGRES_DSN, timeout=2.0)
        try:
            row = await conn.fetchrow(query, lat - delta, lat + delta, lng - delta, lng + delta)
            if row and row["peak_clearance_speed"]:
                return float(row["peak_clearance_speed"])
        finally:
            await conn.close()
    except Exception:
        pass
    return 0.0

async def analyze_traffic_speed(
    h3_index: str, current_avg_speed: float, lat: float = 0.0, lng: float = 0.0,
    timestamp_ms: Optional[int] = None
) -> TrafficSpeedEvidence:
    """
    Compare current fleet average speed vs official authoritative road speed limit with:
    1. LRU Cache (Zero Overpass internet bottleneck).
    2. Traffic Signal & Intersection Filter (highway=traffic_signals / stop).
    3. Multi-Phase Signal Clearance Trajectory Protocol using timestamp_ms for historical data.
    """
    official_limit, road_name, is_signal = await fetch_authoritative_road_limit_and_signal(lat, lng)

    curr_speed = current_avg_speed if current_avg_speed > 0 else official_limit
    speed_ratio = curr_speed / official_limit if official_limit > 0 else 1.0
    speed_drop = max(0.0, 1.0 - speed_ratio)

    # 1. Base State Calculation
    if speed_drop >= 0.65:
        state = "SEVERE_GRIDLOCK"
    elif speed_drop >= 0.35:
        state = "MODERATE_SLOW"
    else:
        state = "CLEAR"

    # 2. Traffic Signal & Multi-Phase Clearance Protocol (Solves 90s-120s Red Light Issue)
    if is_signal and state == "SEVERE_GRIDLOCK":
        # Check if vehicles cleared the intersection at normal speeds after signal turned green
        peak_clearance = await check_post_intersection_clearance_speed(lat, lng, timestamp_ms)
        if peak_clearance >= 0.5 * official_limit:
            # Vehicles successfully accelerated post-signal -> Valid Red Light Wait!
            state = "CLEAR"
            speed_drop = min(speed_drop, 0.20)
        else:
            # Vehicles remained crawling (<10km/h) across multiple 3-min signal cycles -> True Gridlock!
            state = "SEVERE_GRIDLOCK"

    return TrafficSpeedEvidence(
        baseline_speed_kmh=round(official_limit, 1),
        current_speed_kmh=round(curr_speed, 1),
        speed_drop_ratio=round(speed_drop, 3),
        traffic_state=state,
    )
