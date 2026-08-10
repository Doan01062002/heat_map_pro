import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.db_telemetry import query_telemetry, compute_bayesian_smoothed_ratio, compute_wilson_interval

async def test_db_telemetry_tool():
    print("------------ [TOOL TEST 1] db_telemetry.py ------------")
    # Test Porto timestamp
    res = await query_telemetry("8d39220f02ba7f", 41.14780, -8.61071, 60, 1372694282000)
    
    print(f"  • Total Events              : {res.total_events}")
    print(f"  • Unique Drivers            : {res.unique_drivers}")
    print(f"  • Unique Trips              : {res.unique_trips}")
    print(f"  • High Deviation Trips (>150m): {res.high_dev_trips}")
    print(f"  • Fleet Deviation Ratio     : {res.fleet_deviation_ratio * 100:.1f}%")
    print(f"  • Bayesian Smoothed Ratio   : {res.adjusted_deviation_ratio * 100:.1f}%")
    print(f"  • 95% Wilson Interval       : [{res.wilson_lower_bound*100:.1f}%, {res.wilson_upper_bound*100:.1f}%] (±{res.margin_of_error*100:.1f}%)")
    print(f"  • Dynamic AASHTO Threshold  : {res.dynamic_threshold_m}m")
    
    assert res.total_events > 0, "Telemetry total_events should be > 0"
    assert res.dynamic_threshold_m >= 20.0, "Dynamic threshold should be >= 20m"
    print("✅ PASSED: db_telemetry.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_db_telemetry_tool())
