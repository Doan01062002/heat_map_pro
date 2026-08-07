import asyncio
import sys
import os

# Add parent directory to path to import tools and models
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.db_telemetry import (
    compute_bayesian_smoothed_ratio,
    compute_wilson_interval,
    fetch_road_class_threshold,
)

def test_bayesian_smoothing():
    print("------------ [TEST 1] Bayesian Smoothing (Làm mịn Bayes) ------------")
    # Case A: Low Sample Size N=1 (1 trip, 1 deviation)
    ratio_n1 = compute_bayesian_smoothed_ratio(1, 1)
    print(f"  • Mẫu N=1 (1/1 bẻ lái)   : Tỷ lệ thô 100% -> Tỷ lệ Bayes làm mịn: {ratio_n1 * 100:.1f}%")
    assert ratio_n1 < 0.20, f"Expected smoothed ratio < 20%, got {ratio_n1}"

    # Case B: Large Sample Size N=100 (90 deviations)
    ratio_n100 = compute_bayesian_smoothed_ratio(90, 100)
    print(f"  • Mẫu N=100 (90/100 bẻ lái): Tỷ lệ thô 90%  -> Tỷ lệ Bayes làm mịn: {ratio_n100 * 100:.1f}%")
    assert ratio_n100 > 0.80, f"Expected smoothed ratio > 80%, got {ratio_n100}"
    print("✅ PASSED: Bayesian Smoothing Test\n")

def test_wilson_score_interval():
    print("------------ [TEST 2] Wilson Score 95% Interval (Khoảng Tin cậy) ------------")
    # Case A: Small Sample N=1
    lower1, upper1, margin1 = compute_wilson_interval(1, 1)
    print(f"  • Mẫu N=1 (1/1)    : Khoảng tin cậy [{lower1*100:.1f}%, {upper1*100:.1f}%] (Biên sai số: ±{margin1*100:.1f}%)")
    assert margin1 > 0.25, f"Expected large margin of error > 25% for N=1, got {margin1}"

    # Case B: Large Sample N=100
    lower100, upper100, margin100 = compute_wilson_interval(90, 100)
    print(f"  • Mẫu N=100 (90/100): Khoảng tin cậy [{lower100*100:.1f}%, {upper100*100:.1f}%] (Biên sai số: ±{margin100*100:.1f}%)")
    assert margin100 < 0.10, f"Expected small margin of error < 10% for N=100, got {margin100}"
    print("✅ PASSED: Wilson Score Interval Test\n")

async def test_dynamic_road_thresholds():
    print("------------ [TEST 3] Dynamic Road-Class Thresholds (Ngưỡng Động theo Loại Đường) ------------")
    # Test Porto location
    threshold, road_class = await fetch_road_class_threshold(41.14780, -8.61071)
    print(f"  • Tọa độ Porto (41.1478, -8.6107): Cấp đường '{road_class}' -> Ngưỡng mét lệch: {threshold}m")
    assert threshold in [50.0, 150.0, 350.0], f"Invalid threshold {threshold}"
    print("✅ PASSED: Dynamic Road Threshold Test\n")

def main():
    print("==========================================================================")
    print("🧪 BỘ TEST ĐỘC LẬP MÔ HÌNH TOÁN THỐNG KÊ TELEMETRY (MATH & STATS TEST)")
    print("==========================================================================")
    test_bayesian_smoothing()
    test_wilson_score_interval()
    asyncio.run(test_dynamic_road_thresholds())
    print("==========================================================================")
    print("📊 TỔNG KẾT: ALL MATH & STATISTICAL TELEMETRY TESTS PASSED (100%)")
    print("==========================================================================")

if __name__ == "__main__":
    main()
