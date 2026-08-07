import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tests.test_tool_telemetry import test_db_telemetry_tool
from tests.test_tool_weather import test_weather_tool
from tests.test_tool_news import test_news_tool
from tests.test_tool_reverse_geocode import test_reverse_geocode_tool
from tests.test_osrm_alternatives import run_osrm_standalone_tests
from tests.test_tool_driver_profile import test_driver_profile_tool
from tests.test_tool_traffic_speed import test_traffic_speed_tool

async def main():
    print("==========================================================================")
    print("🧪 THIẾT LẬP BỘ UNIT TEST CHUYÊN BIỆT RIÊNG CHO TỪNG TOOL TRONG 6 TOOLS")
    print("==========================================================================")

    await test_db_telemetry_tool()
    await test_weather_tool()
    await test_news_tool()
    await test_reverse_geocode_tool()
    await run_osrm_standalone_tests()
    await test_driver_profile_tool()
    await test_traffic_speed_tool()

    print("==========================================================================")
    print("🎉 TỔNG KẾT: TẤT CẢ 6 TOOLS ĐÃ VƯỢT QUA BỘ TEST CHUYÊN BIỆT ĐỘC LẬP (100% PASSED)")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(main())
