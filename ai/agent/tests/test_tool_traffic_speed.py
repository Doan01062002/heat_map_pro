import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.traffic_speed_ratio import analyze_traffic_speed

async def test_traffic_speed_tool():
    print("------------ [TOOL TEST 6] traffic_speed_ratio.py ------------")
    # Test 1: Normal traffic
    res_normal = await analyze_traffic_speed("8d39220f02ba7f", 34.1, 41.14780, -8.61071)
    print(f"  • Baseline Speed (OSM)  : {res_normal.baseline_speed_kmh} km/h")
    print(f"  • Current Speed         : {res_normal.current_speed_kmh} km/h")
    print(f"  • Speed Drop Ratio      : {res_normal.speed_drop_ratio * 100:.1f}%")
    print(f"  • Traffic State         : {res_normal.traffic_state}")
    assert res_normal.traffic_state == "CLEAR"

    # Test 2: Severe Gridlock Simulation
    res_gridlock = await analyze_traffic_speed("8d39220f02ba7f", 10.0, 41.14780, -8.61071)
    print(f"  • Severe Gridlock State : {res_gridlock.traffic_state} (Drop: {res_gridlock.speed_drop_ratio * 100:.1f}%)")
    assert res_gridlock.traffic_state == "SEVERE_GRIDLOCK"

    print("✅ PASSED: traffic_speed_ratio.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_traffic_speed_tool())
