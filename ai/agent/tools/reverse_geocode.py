import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"

async def reverse_geocode(lat: float, lng: float) -> str:
    """
    Convert (lat, lng) to Vietnamese human-readable location name using Nominatim OpenStreetMap (Free).
    Timeout: 3 seconds.
    """
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

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(NOMINATIM_URL, params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                display_name = data.get("display_name", "")
                if display_name:
                    # Shorten name if too long
                    parts = [p.strip() for p in display_name.split(",")]
                    if len(parts) > 4:
                        return ", ".join(parts[:4])
                    return display_name
    except Exception as e:
        print(f"[Tool: ReverseGeocode] Fallback: {e}")

    return f"Khu vực ({lat:.4f}, {lng:.4f})"
