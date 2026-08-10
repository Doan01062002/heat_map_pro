import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.driver_profile import query_driver_profile

async def test_driver_profile_tool():
    print("------------ [TOOL TEST 5] driver_profile.py ------------")
    # Test 1: Cell driver group CTE 30-day compliance query
    res_cell = await query_driver_profile(None, "8d39220f02ba7f", 41.14780, -8.61071)
    print(f"  • Cell Group ID          : {res_cell.driver_id}")
    print(f"  • 30-day System Compliance: {res_cell.compliance_rate_30d * 100:.1f}%")
    print(f"  • 30-day Total Trips     : {res_cell.total_trips_30d}")
    print(f"  • Reputation Level       : {res_cell.reputation_level}")
    assert res_cell.compliance_rate_30d >= 0.0 and res_cell.compliance_rate_30d <= 1.0

    # Test 2: Repeat offender driver
    res_offender = await query_driver_profile("DRV_REPEATED_OFFENDER", "8d39220f0acc897f", 41.1538, -8.6133)
    print(f"  • Driver ID              : {res_offender.driver_id}")
    print(f"  • Compliance Rate        : {res_offender.compliance_rate_30d * 100:.1f}%")
    print(f"  • Reputation Level       : {res_offender.reputation_level}")
    assert res_offender.reputation_level == "HIGH_RISK", "Repeated offender should be HIGH_RISK"

    print("✅ PASSED: driver_profile.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_driver_profile_tool())
