import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.weather import fetch_weather

async def test_weather_tool():
    print("------------ [TOOL TEST 2] weather.py ------------")
    # Test 15-minute historical archive query for Porto 2013
    res = await fetch_weather(41.14780, -8.61071, 1372694282000)
    
    print(f"  • Nhiệt độ        : {res.temperature} °C")
    print(f"  • Lượng mưa mm/h  : {res.rain_mm} mm/h")
    print(f"  • Mô tả           : {res.description}")
    print(f"  • Vận tốc gió     : {res.wind_speed} km/h")
    print(f"  • Mốc thời gian 15m: {res.weather_time}")

    assert res.temperature is not None, "Temperature should not be None"
    assert res.weather_time != "Unknown", "Weather time should be parsed"
    print("✅ PASSED: weather.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_weather_tool())
