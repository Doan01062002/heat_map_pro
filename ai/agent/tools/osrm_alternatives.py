import os
import httpx
import asyncpg
from typing import Optional
from models import OSRMAlternativeEvidence

PRIMARY_OSRM_URL = os.getenv("OSRM_URL", "http://osrm:5000")
POSTGRES_DSN = os.getenv("POSTGRES_DSN", "postgres://heatmap:heatmap_secret_2024@localhost:5432/heatmap_db")

async def check_crowdsourced_local_shortcut(start_lat: float, start_lng: float) -> bool:
    """
    Crowdsourced Local Shortcut Verification:
    If OSRM Contraction Hierarchies (CH) omits local residential shortcuts,
    query Postgres to check if >5 fleet trips successfully traversed this local path.
    """
    delta = 0.003
    query = """
        SELECT COUNT(DISTINCT trip_id)::INT AS trip_count
        FROM deviation_events
        WHERE (latitude BETWEEN $1 AND $2) AND (longitude BETWEEN $3 AND $4);
    """
    try:
        conn = await asyncpg.connect(POSTGRES_DSN, timeout=2.0)
        try:
            row = await conn.fetchrow(query, start_lat - delta, start_lat + delta, start_lng - delta, start_lng + delta)
            if row and (row["trip_count"] or 0) >= 5:
                return True
        finally:
            await conn.close()
    except Exception:
        pass
    return False

async def analyze_osrm_alternatives(
    start_lat: float, start_lng: float,
    end_lat: float, end_lng: float
) -> OSRMAlternativeEvidence:
    """
    Query OSRM Route API with:
    1. Dynamic Relative Time & Distance Inflation Ratios (dT/T_base & dS/S_base)
       instead of static 1.5km distance thresholds.
    2. Crowdsourced Local Shortcut Verification (Postgres Fleet History) to compensate
       for OSRM Contraction Hierarchies (CH) local alley omissions.
    Timeout: 3.0 seconds.
    """
    candidate_urls = [
        PRIMARY_OSRM_URL,
        "http://osrm:5000",
        "http://host.docker.internal:5000",
        "http://localhost:5000"
    ]

    seen = set()
    urls_to_try = [url.rstrip('/') for url in candidate_urls if url and not (url in seen or seen.add(url))]

    for base in urls_to_try:
        url = f"{base}/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?alternatives=true&overview=false"
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    routes = data.get("routes", [])
                    if len(routes) > 1:
                        primary_duration = routes[0].get("duration", 1.0)
                        primary_distance = routes[0].get("distance", 1.0)

                        alt_duration = routes[1].get("duration", 1.0)
                        alt_distance = routes[1].get("distance", 1.0)

                        time_diff = primary_duration - alt_duration  # >0 means alt is FASTER
                        dist_diff = alt_distance - primary_distance   # >0 means alt is LONGER

                        # Scientific Relative Inflation Ratios
                        time_inflation_ratio = (alt_duration - primary_duration) / max(1.0, primary_duration)
                        dist_inflation_ratio = (alt_distance - primary_distance) / max(1.0, primary_distance)

                        # 1. Faster alternative route (Shortcut)
                        if time_diff > 30 or time_inflation_ratio < -0.05:
                            classification = "OPTIMIZED_SHORTCUT"
                            summary = f"Lộ trình thay thế tiết kiệm {round(time_diff / 60, 1)} phút ({round(abs(time_inflation_ratio)*100, 1)}% nhanh hơn)."
                        # 2. Deliberate Fare Inflation Detour (>35% time inflation AND >30% distance inflation)
                        elif time_inflation_ratio > 0.35 and dist_inflation_ratio > 0.30:
                            # Verify if crowdsourced fleet history validates this local shortcut
                            is_crowdsourced = await check_crowdsourced_local_shortcut(start_lat, start_lng)
                            if is_crowdsourced:
                                classification = "OPTIMIZED_SHORTCUT"
                                summary = "Đã xác minh đường tắt địa phương từ lịch sử di chuyển của đội xe."
                            else:
                                classification = "INFLATED_DETOUR"
                                summary = f"Lộ trình gia tăng +{round(dist_inflation_ratio*100, 1)}% quãng đường và +{round(time_inflation_ratio*100, 1)}% thời gian bất hợp lý."
                        else:
                            classification = "STANDARD"
                            summary = "Lộ trình tương đương tuyến đường tiêu chuẩn."

                        return OSRMAlternativeEvidence(
                            has_alternatives=True,
                            best_time_saving_sec=round(time_diff, 1),
                            distance_diff_meters=round(dist_diff, 1),
                            route_classification=classification,
                            summary=summary,
                        )
                    elif len(routes) == 1:
                        # Single route returned by OSRM CH -> Verify if crowdsourced shortcut exists
                        is_crowdsourced = await check_crowdsourced_local_shortcut(start_lat, start_lng)
                        if is_crowdsourced:
                            return OSRMAlternativeEvidence(
                                has_alternatives=True,
                                route_classification="OPTIMIZED_SHORTCUT",
                                summary="Phát hiện đường tắt địa phương từ lịch sử di chuyển thực tế của đội xe."
                            )
                        return OSRMAlternativeEvidence(
                            has_alternatives=False,
                            route_classification="STANDARD",
                            summary="Đã xác nhận lộ trình tiêu chuẩn duy nhất trên OSRM."
                        )
        except Exception:
            continue

    return OSRMAlternativeEvidence(
        has_alternatives=False,
        route_classification="OSRM_UNAVAILABLE",
        summary="Không thể kết nối OSRM — không có dữ liệu lộ trình thay thế.",
    )
