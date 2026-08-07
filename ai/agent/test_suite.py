import asyncio
import httpx
import json
import sys

AI_AGENT_BASE_URL = "http://localhost:8090"

# Standard Test Matrix: 4 Core Operational Scenarios
TEST_CASES = [
    {
        "id": "TC-01",
        "name": "Bất khả kháng do Mưa lớn / Thời tiết xấu",
        "payload": {
            "h3_index": "8d39220f02ba7f",
            "lat": 41.14780,
            "lng": -8.61071,
            "time_window_minutes": 60,
            "timestamp_ms": 1383307200000,  # Historical rainy day Nov 1, 2013
        },
        "expected_risk_levels": ["SAFE_FORCE_MAJEURE"],
        "min_confidence": 0.85,
    },
    {
        "id": "TC-02",
        "name": "Bất khả kháng do Kẹt xe nghiêm trọng (Sụt giảm vận tốc >65%)",
        "payload": {
            "h3_index": "8c39220f54e6dff",
            "lat": 41.16275,
            "lng": -8.62121,
            "time_window_minutes": 60,
            "timestamp_ms": 1372694282000,
        },
        "expected_risk_levels": ["SAFE_FORCE_MAJEURE", "SUSPICIOUS"],
        "min_confidence": 0.75,
    },
    {
        "id": "TC-03",
        "name": "Cảnh báo Gian lận rẽ đường lòng vòng (Thời tiết đẹp, Tài xế vi phạm)",
        "payload": {
            "h3_index": "8d39220f0acc897f",
            "lat": 41.15380,
            "lng": -8.61329,
            "time_window_minutes": 60,
            "timestamp_ms": 1372694282000,
            "driver_id": "DRV_REPEATED_OFFENDER"
        },
        "expected_risk_levels": ["FRAUD_ALERT", "SUSPICIOUS"],
        "min_confidence": 0.70,
    },
    {
        "id": "TC-04",
        "name": "Theo dõi trường hợp bẻ lái đơn lẻ / Nghi vấn nhẹ",
        "payload": {
            "h3_index": "8d39220f02ba7f",
            "lat": 41.14780,
            "lng": -8.61071,
            "time_window_minutes": 60,
            "timestamp_ms": 1372694282000,
        },
        "expected_risk_levels": ["SAFE_FORCE_MAJEURE", "SUSPICIOUS", "FRAUD_ALERT"],
        "min_confidence": 0.70,
    }
]

async def run_test_suite():
    print("==========================================================================")
    print("🚀 BỘ TEST CHUẨN KIỂM THỬ TÍNH ĐÚNG ĐẮN CỦA AI AGENT (STANDARDIZED SUITE)")
    print("==========================================================================")
    
    passed_count = 0
    total_count = len(TEST_CASES)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Health check
        try:
            health = await client.get(f"{AI_AGENT_BASE_URL}/health")
            if health.status_code != 200:
                print("❌ ERROR: AI Agent Service `/health` endpoint failed!")
                sys.exit(1)
            print("🟢 AI Agent Service status: ONLINE & HEALTHY\n")
        except Exception as e:
            print(f"❌ CRITICAL: Cannot connect to AI Agent at {AI_AGENT_BASE_URL}: {e}")
            sys.exit(1)

        # 2. Run Test Cases
        for tc in TEST_CASES:
            print(f"------------ [{tc['id']}] {tc['name']} ------------")
            try:
                resp = await client.post(f"{AI_AGENT_BASE_URL}/investigate", json=tc["payload"])
                if resp.status_code != 200:
                    print(f"❌ FAIL: HTTP status {resp.status_code} - {resp.text}")
                    continue

                data = resp.json()
                risk = data.get("risk_level", "")
                conf = float(data.get("confidence", 0.0))
                summary = data.get("summary", "")
                rec = data.get("recommendation", "")
                evidence = data.get("evidence", {})

                # Validate outputs against expectations
                is_risk_valid = risk in tc["expected_risk_levels"]
                is_conf_valid = conf >= tc["min_confidence"]

                print(f"  • Risk Level      : {risk} (Kỳ vọng: {tc['expected_risk_levels']})")
                print(f"  • Confidence      : {conf*100:.1f}% (Tối thiểu: {tc['min_confidence']*100:.0f}%)")
                print(f"  • Vị trí          : {evidence.get('location_name', 'N/A')}")
                print(f"  • Mốc thời gian   : {evidence.get('target_time_str', 'N/A')}")
                print(f"  • Chẩn đoán AI    : {summary}")
                print(f"  • Đề xuất Admin   : {rec}")

                if is_risk_valid and is_conf_valid:
                    print(f"✅ PASSED [{tc['id']}]\n")
                    passed_count += 1
                else:
                    print(f"⚠️ WARNING: Validation mismatch for [{tc['id']}]\n")

            except Exception as e:
                print(f"❌ FAIL [{tc['id']}]: Unexpected Exception: {e}\n")

    print("==========================================================================")
    print(f"📊 KẾT QUẢ ĐÁNH GIÁ: {passed_count}/{total_count} TEST CASES PASSED ({passed_count/total_count*100:.1f}%)")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(run_test_suite())
