import asyncio
from datetime import datetime, timezone
from models import InvestigateRequest, Evidence, DiagnosisResult
from tools.weather import fetch_weather
from tools.reverse_geocode import reverse_geocode
from tools.news_search import search_incidents
from tools.db_telemetry import query_telemetry
from tools.osrm_alternatives import analyze_osrm_alternatives
from tools.driver_profile import query_driver_profile
from tools.traffic_speed_ratio import analyze_traffic_speed
from llm_client import generate_diagnosis

async def run_investigation(req: InvestigateRequest) -> DiagnosisResult:
    """
    ReAct Engine Execution Loop:
    1. Concurrently run DB Telemetry, Weather API, Reverse Geocode, OSRM Alternatives, Driver Profile, and Traffic Speed
    2. Conditionally trigger news search
    3. Synthesize all evidence and generate grounded diagnosis via LLM Client
    """
    print(f"[ReAct Engine] Investigating cell {req.h3_index} at ({req.lat}, {req.lng}) at timestamp {req.timestamp_ms}...")

    # Step 1: Concurrently gather initial telemetry, weather, and geocode
    telemetry, weather, location_name = await asyncio.gather(
        query_telemetry(
            req.h3_index, req.lat, req.lng, req.time_window_minutes, req.timestamp_ms,
            bbox_min_lat=req.min_lat, bbox_max_lat=req.max_lat,
            bbox_min_lng=req.min_lng, bbox_max_lng=req.max_lng,
        ),
        fetch_weather(req.lat, req.lng, req.timestamp_ms),
        reverse_geocode(req.lat, req.lng),
    )

    # Step 2: Run secondary tools using telemetry (including dynamic threshold for driver profile)
    # Use actual trip end point if provided; fallback to a small offset in the same lat direction
    # (avoids the bug of always analyzing a fixed NE direction regardless of actual driver path)
    end_lat = req.end_lat if req.end_lat is not None else req.lat + 0.003
    end_lng = req.end_lng if req.end_lng is not None else req.lng

    driver_profile, osrm_alts, traffic_speed = await asyncio.gather(
        query_driver_profile(
            req.driver_id, req.h3_index, req.lat, req.lng,
            deviation_threshold_m=telemetry.dynamic_threshold_m,
        ),
        analyze_osrm_alternatives(req.lat, req.lng, end_lat, end_lng),
        analyze_traffic_speed(req.h3_index, telemetry.avg_speed_kmh, req.lat, req.lng, req.timestamp_ms),
    )

    # Step 3: Conditionally trigger news search
    news = []
    should_search_news = (
        telemetry.high_dev_trips > 0 or
        traffic_speed.traffic_state == "SEVERE_GRIDLOCK" or
        (weather and weather.rain_mm and weather.rain_mm > 5.0)
    )

    if should_search_news:
        news = await search_incidents(req.lat, req.lng, location_name, req.timestamp_ms)

    # Format human-readable target time string
    target_time_str = "Thời gian thực (Real-time)"
    if req.timestamp_ms and req.timestamp_ms > 0:
        dt = datetime.fromtimestamp(req.timestamp_ms / 1000.0, tz=timezone.utc)
        target_time_str = dt.strftime("%Y-%m-%d %H:%M UTC")

    # If frontend provided live session stats (the numbers shown in popup), override DB telemetry.
    # Session stats = current monitoring window; DB telemetry = full history. Popup shows session stats.
    if req.session_trips is not None and req.session_trips > 0:
        session_high_dev = req.session_high_dev_trips or 0
        # Always compute ratio from actual counts for accuracy — ignore incoming ratio if unreliable
        if req.session_trips > 0:
            computed_ratio = session_high_dev / req.session_trips
        else:
            computed_ratio = 0.0
        # Accept incoming ratio only if it's in 0-1 range; otherwise use computed
        incoming = req.session_deviation_ratio or 0.0
        if incoming > 1.0:
            incoming = incoming / 100.0  # frontend sent percent, normalize
        session_ratio = incoming if incoming > 0 else computed_ratio

        from tools.db_telemetry import compute_bayesian_smoothed_ratio, compute_wilson_interval, _build_telemetry
        adj = compute_bayesian_smoothed_ratio(session_high_dev, req.session_trips)
        lo, hi, margin = compute_wilson_interval(session_high_dev, req.session_trips)
        telemetry = telemetry.model_copy(update={
            "unique_drivers": req.session_drivers or telemetry.unique_drivers,
            "unique_trips": req.session_trips,
            "high_dev_trips": session_high_dev,
            "fleet_deviation_ratio": round(session_ratio, 3),
            "adjusted_deviation_ratio": adj,
            "wilson_lower_bound": lo,
            "wilson_upper_bound": hi,
            "margin_of_error": margin,
            "avg_deviation_m": req.session_avg_deviation_m or telemetry.avg_deviation_m,
        })

    # Step 4: Bundle all evidence
    evidence = Evidence(
        weather=weather,
        news=news,
        fleet_telemetry=telemetry,
        location_name=location_name,
        target_time_str=target_time_str,
        osrm_alternatives=osrm_alts,
        driver_profile=driver_profile,
        traffic_speed=traffic_speed,
    )

    # Step 5: Generate grounded diagnosis
    diagnosis = await generate_diagnosis(req.h3_index, evidence)
    return diagnosis
