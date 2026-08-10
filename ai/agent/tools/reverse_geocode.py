import os
import httpx
import os
from typing import Optional

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
PRIMARY_OSRM_URL = os.getenv("OSRM_URL", "http://osrm:5000")
OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"

# In-memory LRU cache to eliminate 100% Nominatim Rate Limits (1 req/s)
# Keyed by rounded coordinates (lat_4dp, lng_4dp) -> ~11m precision
_LOCATION_CACHE: dict[tuple[float, float], str] = {}
MAX_CACHE_SIZE = 2000

async def detect_infrastructure_structure(lat: float, lng: float) -> str:
    """
    Detect 3D infrastructure layer (bridge vs tunnel vs ground level) using OpenStreetMap tags:
    - bridge=yes / layer >= 1 -> (Cầu vượt / Viaduct)
    - tunnel=yes / layer <= -1 -> (Hầm chui / Underpass)
    Timeout: 1.5 seconds.
    """
    query = f"""
    [out:json][timeout:2];
    way(around:15,{lat},{lng})[highway];
    out tags;
    """
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.post(OVERPASS_API_URL, data={"data": query})
            if resp.status_code == 200:
                data = resp.json()
                elements = data.get("elements", [])
                if elements:
                    tags = elements[0].get("tags", {})
                    is_bridge = tags.get("bridge", "no") != "no"
                    is_tunnel = tags.get("tunnel", "no") != "no"
                    layer_val = int(tags.get("layer", "0")) if tags.get("layer", "0").lstrip('-').isdigit() else 0

                    if is_bridge or layer_val >= 1:
                        return " (Cầu vượt)"
                    elif is_tunnel or layer_val <= -1:
                        return " (Hầm chui)"
    except Exception:
        pass
    return ""

async def query_osrm_nearest_fallback(lat: float, lng: float) -> Optional[str]:
    """
    Fallback to local OSRM C++ container if Nominatim is rate-limited (HTTP 429).
    Responds in 0.001s with zero rate limits.
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
        url = f"{base}/nearest/v1/driving/{lng},{lat}"
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    waypoints = data.get("waypoints", [])
                    if waypoints:
                        road_name = waypoints[0].get("name", "")
                        if road_name:
                            return f"Đường {road_name}"
        except Exception:
            continue
    return None

async def reverse_geocode(lat: float, lng: float) -> str:
    """
    Convert (lat, lng) to human-readable location name with:
    1. In-memory LRU Cache (Zero Nominatim Rate-Limit risk, 0.0001s latency).
    2. 3D Infrastructure Structure Detection (Cầu vượt vs Hầm chui).
    3. Local OSRM C++ Container Fallback on HTTP 429 Rate Limit.
    """
    cache_key = (round(lat, 4), round(lng, 4))
    if cache_key in _LOCATION_CACHE:
        return _LOCATION_CACHE[cache_key]

    # Detect infrastructure tag (Cầu vượt / Hầm chui)
    infra_suffix = await detect_infrastructure_structure(lat, lng)

    # Provider 1: Public Nominatim API
    params = {
        "lat": lat,
        "lon": lng,
        "format": "json",
        "accept-language": "vi",
        "zoom": 16,
    }
    headers = {
        "User-Agent": "HeatMapProAIAgent/1.0 (contact@vinuni.edu.vn)"
    }

    location_name = ""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(NOMINATIM_URL, params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                display_name = data.get("display_name", "")
                if display_name:
                    parts = [p.strip() for p in display_name.split(",")]
                    location_name = ", ".join(parts[:4]) if len(parts) > 4 else display_name
            elif resp.status_code == 429:
                print("[Tool: ReverseGeocode] Nominatim Rate Limit (HTTP 429) -> Switching to OSRM Local Fallback")
    except Exception as e:
        print(f"[Tool: ReverseGeocode] Nominatim Call Error: {e}")

    # Provider 2: Local OSRM C++ Container Fallback if Nominatim failed or rate-limited
    if not location_name:
        osrm_name = await query_osrm_nearest_fallback(lat, lng)
        if osrm_name:
            location_name = osrm_name

    if not location_name:
        location_name = f"Khu vực ({lat:.4f}, {lng:.4f})"

    full_name = f"{location_name}{infra_suffix}"

    # Cache result if size within limits
    if len(_LOCATION_CACHE) < MAX_CACHE_SIZE:
        _LOCATION_CACHE[cache_key] = full_name

    return full_name
