import httpx
from datetime import datetime, timezone
from typing import Optional
from models import WeatherEvidence

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# WMO Weather interpretation codes (WW)
WEATHER_CODES = {
    0: "Trời quang mây (Clear sky)",
    1: "Chủ yếu quang mây (Mainly clear)",
    2: "Có mây rải rác (Partly cloudy)",
    3: "Nhiều mây (Overcast)",
    45: "Sương mù (Fog)",
    48: "Sương mù đóng băng (Depositing rime fog)",
    51: "Mưa phun nhẹ (Light drizzle)",
    53: "Mưa phun vừa (Moderate drizzle)",
    55: "Mưa phun nặng hạt (Dense drizzle)",
    61: "Mưa nhẹ (Light rain)",
    63: "Mưa vừa (Moderate rain)",
    65: "Mưa rất lớn (Heavy rain)",
    80: "Mưa rào nhẹ (Light rain showers)",
    81: "Mưa rào vừa (Moderate rain showers)",
    82: "Mưa rào rất mạnh (Violent rain showers)",
    95: "Dông bão (Thunderstorm)",
    96: "Dông bão có mưa đá nhẹ (Thunderstorm with light hail)",
    99: "Dông bão có mưa đá mạnh (Thunderstorm with heavy hail)",
}

async def fetch_weather(lat: float, lng: float, timestamp_ms: Optional[int] = None) -> Optional[WeatherEvidence]:
    """
    Fetch exact historical or real-time weather at coordinates using Open-Meteo API (100% Free, 0 API Key).
    If timestamp_ms is provided for historical driver trips (e.g. Porto 2013 dataset),
    queries Open-Meteo Historical Archive API for that exact historical date & hour!
    Timeout: 4 seconds.
    """
    if timestamp_ms and timestamp_ms > 0:
        try:
            dt = datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc)
            date_str = dt.strftime("%Y-%m-%d")
            hour_idx = dt.hour
            formatted_time_str = dt.strftime("%Y-%m-%d %H:00 UTC")

            params = {
                "latitude": lat,
                "longitude": lng,
                "start_date": date_str,
                "end_date": date_str,
                "hourly": "temperature_2m,rain,weather_code,wind_speed_10m",
                "timezone": "UTC"
            }

            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(OPEN_METEO_ARCHIVE_URL, params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    hourly = data.get("hourly", {})
                    temps = hourly.get("temperature_2m", [])
                    rains = hourly.get("rain", [])
                    codes = hourly.get("weather_code", [])
                    winds = hourly.get("wind_speed_10m", [])

                    if temps and len(temps) > hour_idx:
                        temp = temps[hour_idx]
                        rain = rains[hour_idx] if len(rains) > hour_idx else 0.0
                        code = codes[hour_idx] if len(codes) > hour_idx else 0
                        wind = winds[hour_idx] if len(winds) > hour_idx else 0.0
                        desc = WEATHER_CODES.get(code, f"Thời tiết mã {code}")

                        return WeatherEvidence(
                            temperature=temp,
                            rain_mm=rain,
                            description=desc,
                            wind_speed=wind,
                            weather_time=formatted_time_str,
                        )
        except Exception as e:
            print(f"[Tool: Weather Archive Error] {e}")

    # Fallback / Real-time weather call
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "temperature_2m,rain,showers,weather_code,wind_speed_10m",
        "timezone": "auto"
    }

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(OPEN_METEO_FORECAST_URL, params=params)
            if resp.status_code == 200:
                data = resp.json()
                current = data.get("current", {})

                temp = current.get("temperature_2m")
                rain = (current.get("rain") or 0.0) + (current.get("showers") or 0.0)
                code = current.get("weather_code", 0)
                wind = current.get("wind_speed_10m")

                desc = WEATHER_CODES.get(code, f"Thời tiết mã {code}")

                return WeatherEvidence(
                    temperature=temp,
                    rain_mm=rain,
                    description=desc,
                    wind_speed=wind,
                    weather_time="Real-time",
                )
    except Exception as e:
        print(f"[Tool: Weather Forecast Error] {e}")

    return WeatherEvidence(description="Không thể kết nối API thời tiết")
