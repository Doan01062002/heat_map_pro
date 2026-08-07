import os
import httpx
from typing import Optional
from models import OSRMAlternativeEvidence

OSRM_URL = os.getenv("OSRM_URL", "http://localhost:5000")

async def analyze_osrm_alternatives(
    start_lat: float, start_lng: float,
    end_lat: float, end_lng: float
) -> OSRMAlternativeEvidence:
    """
    Query OSRM Route API with alternatives=true to evaluate whether an alternative route
    was faster (valid shortcut) or significantly longer (deliberate fare inflation detour).
    100% Free, queries local OSRM C++ container.
    Timeout: 3 seconds.
    """
    url = f"{OSRM_URL.rstrip('/')}/route/v1/driving/{start_lng},{start_lat};{end_lng},{end_lat}?alternatives=true&overview=false"

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                routes = data.get("routes", [])
                if len(routes) > 1:
                    primary_duration = routes[0].get("duration", 0.0)
                    primary_distance = routes[0].get("distance", 0.0)

                    alt_duration = routes[1].get("duration", 0.0)
                    alt_distance = routes[1].get("distance", 0.0)

                    time_diff = primary_duration - alt_duration  # >0 means alt is FASTER
                    dist_diff = alt_distance - primary_distance   # >0 means alt is LONGER

                    if time_diff > 60:
                        classification = "OPTIMIZED_SHORTCUT"
                        summary = f"Lộ trình thay thế tiết kiệm {round(time_diff / 60, 1)} phút di chuyển."
                    elif dist_diff > 1500 and time_diff < -300:
                        classification = "INFLATED_DETOUR"
                        summary = f"Lộ trình kéo dài thêm {round(dist_diff / 1000, 1)}km và tốn thêm {round(abs(time_diff) / 60, 1)} phút bất hợp lý."
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
    except Exception as e:
        print(f"[Tool: OSRM Alternatives Fallback] {e}")

    return OSRMAlternativeEvidence(
        has_alternatives=False,
        summary="Đang sử dụng lộ trình đơn tiêu chuẩn OSRM."
    )
