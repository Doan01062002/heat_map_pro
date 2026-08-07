import asyncio
from datetime import datetime, timezone
from models import InvestigateRequest, Evidence, DiagnosisResult
from tools.weather import fetch_weather
from tools.reverse_geocode import reverse_geocode
from tools.news_search import search_incidents
from tools.db_telemetry import query_telemetry
from llm_client import generate_diagnosis

async def run_investigation(req: InvestigateRequest) -> DiagnosisResult:
    """
    ReAct Engine Execution Loop:
    1. Concurrently run DB Telemetry, Historical/Live Weather API, and Reverse Geocode
    2. Check if news search is warranted based on telemetry/weather anomalies
    3. Synthesize all evidence and generate grounded diagnosis via LLM Client
    """
    print(f"[ReAct Engine] Investigating cell {req.h3_index} at ({req.lat}, {req.lng}) at timestamp {req.timestamp_ms}...")

    # Step 1: Concurrently gather initial telemetry, weather (historical or live), and location name
    telemetry, weather, location_name = await asyncio.gather(
        query_telemetry(req.h3_index, req.lat, req.lng, req.time_window_minutes, req.timestamp_ms),
        fetch_weather(req.lat, req.lng, req.timestamp_ms),
        reverse_geocode(req.lat, req.lng),
    )

    # Step 2: Conditionally trigger news search
    news = []
    should_search_news = (
        telemetry.high_dev_trips > 0 or
        (weather and weather.rain_mm and weather.rain_mm > 5.0)
    )

    if should_search_news:
        news = await search_incidents(req.lat, req.lng, location_name, req.timestamp_ms)

    # Format human-readable target time string
    target_time_str = "Thời gian thực (Real-time)"
    if req.timestamp_ms and req.timestamp_ms > 0:
        dt = datetime.fromtimestamp(req.timestamp_ms / 1000.0, tz=timezone.utc)
        target_time_str = dt.strftime("%Y-%m-%d %H:%M UTC")

    # Step 3: Bundle evidence
    evidence = Evidence(
        weather=weather,
        news=news,
        fleet_telemetry=telemetry,
        location_name=location_name,
        target_time_str=target_time_str,
    )

    # Step 4: Generate grounded diagnosis
    diagnosis = await generate_diagnosis(req.h3_index, evidence)
    return diagnosis
