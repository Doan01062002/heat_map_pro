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

async def run_safe(name: str, coro) -> bool:
    """Run a test coroutine and return True only if no exception raised."""
    try:
        await coro
        return True
    except AssertionError as e:
        print(f"FAILED [{name}]: {e}")
        return False
    except Exception as e:
        print(f"ERROR [{name}]: {e}")
        return False

async def run_osrm_safe() -> bool:
    """OSRM returns (passed, total). Only True if ALL subtests pass."""
    try:
        passed, total = await run_osrm_standalone_tests()
        return passed == total
    except Exception as e:
        print(f"ERROR [OSRM]: {e}")
        return False

async def main():
    print("==========================================================================")
    print("THIET LAP BO UNIT TEST CHUYEN BIET RIENG CHO TUNG TOOL TRONG 6 TOOLS")
    print("==========================================================================")

    results = [
        await run_safe("db_telemetry.py",       test_db_telemetry_tool()),
        await run_safe("weather.py",             test_weather_tool()),
        await run_safe("news_search.py",         test_news_tool()),
        await run_safe("reverse_geocode.py",     test_reverse_geocode_tool()),
        await run_osrm_safe(),
        await run_safe("driver_profile.py",      test_driver_profile_tool()),
        await run_safe("traffic_speed_ratio.py", test_traffic_speed_tool()),
    ]

    passed = sum(results)
    total  = len(results)
    pct    = passed / total * 100

    print("==========================================================================")
    if passed == total:
        print(f"TONG KET: TAT CA {total} TOOLS DA VUOT QUA BO TEST (100% PASSED)")
    else:
        failed = total - passed
        print(f"TONG KET: {passed}/{total} PASSED ({pct:.0f}%) -- {failed} TOOL(S) THAT BAI")
        print("  -> OSRM that bai la BINH THUONG neu chua co ban do (vietnam-latest.osrm)")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(main())
