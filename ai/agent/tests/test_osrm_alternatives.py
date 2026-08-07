import asyncio
import sys
import os

# Add parent directory to path to import tools and models
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.osrm_alternatives import analyze_osrm_alternatives
from models import OSRMAlternativeEvidence

TEST_CASES_OSRM = [
    {
        "name": "TC-OSRM-01: Lộ trình tiêu chuẩn Porto (Center to Bridge)",
        "start": (41.14780, -8.61071),
        "end": (41.15380, -8.61329),
        "expected_classifications": ["STANDARD", "OPTIMIZED_SHORTCUT"],
    },
    {
        "name": "TC-OSRM-02: Lộ trình qua nút giao thông Porto (Baixa to Boavista)",
        "start": (41.14850, -8.61100),
        "end": (41.15800, -8.62900),
        "expected_classifications": ["STANDARD", "OPTIMIZED_SHORTCUT", "INFLATED_DETOUR"],
    },
    {
        "name": "TC-OSRM-03: Lộ trình đường dài Porto (Cedofeita to Campanhã)",
        "start": (41.16275, -8.62121),
        "end": (41.15000, -8.58500),
        "expected_classifications": ["STANDARD", "OPTIMIZED_SHORTCUT"],
    }
]

async def run_osrm_standalone_tests():
    print("==========================================================================")
    print("🧪 BỘ TEST CHUYÊN BIỆT DÀNH RIÊNG CHO TOOL OSRM ALTERNATIVE ROUTES")
    print("==========================================================================")

    passed_count = 0
    total_count = len(TEST_CASES_OSRM)

    for tc in TEST_CASES_OSRM:
        print(f"------------ [{tc['name']}] ------------")
        start_lat, start_lng = tc["start"]
        end_lat, end_lng = tc["end"]

        try:
            res: OSRMAlternativeEvidence = await analyze_osrm_alternatives(
                start_lat, start_lng, end_lat, end_lng
            )

            print(f"  • Có đường phụ thay thế? : {res.has_alternatives}")
            print(f"  • Chênh lệch quãng đường : {res.distance_diff_meters} mét")
            print(f"  • Tiết kiệm thời gian    : {res.best_time_saving_sec} giây")
            print(f"  • Phân loại lộ trình     : {res.route_classification} (Kỳ vọng: {tc['expected_classifications']})")
            print(f"  • Tóm tắt đánh giá       : {res.summary}")

            if res.route_classification in tc["expected_classifications"]:
                print(f"✅ PASSED [{tc['name']}]\n")
                passed_count += 1
            else:
                print(f"❌ FAIL [{tc['name']}]: Classification {res.route_classification} not in {tc['expected_classifications']}\n")

        except Exception as e:
            print(f"❌ FAIL [{tc['name']}]: Exception {e}\n")

    print("==========================================================================")
    print(f"📊 KẾT QUẢ ĐÁNH GIÁ OSRM TOOL: {passed_count}/{total_count} PASSED ({passed_count/total_count*100:.1f}%)")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(run_osrm_standalone_tests())
