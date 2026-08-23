import os
import json
import httpx
import logging
import asyncio
from typing import Optional
from models import Evidence, DiagnosisResult

logger = logging.getLogger("ai_agent.llm_client")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Bạn là Hệ thống Phân tích Điểm nóng Giao thông — AI phân tích bất thường lộ trình.

NHIỆM VỤ: Nhận dữ liệu bằng chứng thực tế từ một ô lưới H3 (khu vực ~100m²) và đưa ra phân tích LOGIC, DỄ HIỂU.

=== NGUYÊN TẮC PHÂN LOẠI ===

🟢 "SAFE_FORCE_MAJEURE" — Có nguyên nhân khách quan rõ ràng:
   Mưa lớn ≥ 10mm/h, hoặc có tin tức sự kiện giao thông (ngập, tai nạn, thi công),
   hoặc kẹt xe nghiêm trọng (tốc độ giảm ≥ 65%), hoặc OSRM xác nhận đường tắt tối ưu,
   hoặc ≥ 50% đội xe cùng rẽ và uy tín nhóm tốt (≥ 85%).

🔴 "FRAUD_ALERT" — Bất thường cao, không có yếu tố khách quan:
   OSRM phát hiện rẽ lòng vòng (INFLATED_DETOUR), hoặc uy tín khu vực thấp (< 70%)
   kết hợp tỷ lệ lệch ≥ 40%, trong điều kiện thời tiết tốt, giao thông thông thoáng.

🟡 "SUSPICIOUS" — Chưa đủ bằng chứng kết luận:
   Tỷ lệ lệch ở mức trung bình (15-50%), không có yếu tố khách quan rõ ràng
   nhưng cũng chưa đủ dấu hiệu gian lận cố ý.

=== QUY TẮC VỀ MẪU NHỎ ===
Nếu biên sai số (margin_of_error) > 0.25: confidence ≤ 0.75, ghi chú cỡ mẫu nhỏ.

=== YÊU CẦU OUTPUT — JSON duy nhất ===
{
  "risk_level": "SAFE_FORCE_MAJEURE" | "SUSPICIOUS" | "FRAUD_ALERT",
  "confidence": 0.0 → 1.0,
  "observation": "1-2 câu MÔ TẢ hiện tượng: có bao nhiêu tài xế, tỷ lệ lệch tuyến bao nhiêu, khu vực nào.",
  "context": "1-2 câu giải thích BỐI CẢNH: thời tiết, giao thông, có/không có sự kiện bất thường nào giải thích.",
  "conclusion": "1 câu KẾT LUẬN ngắn gọn dựa trên bằng chứng. Không đưa đề xuất hành chính cụ thể vì đây là dữ liệu tổng hợp của NHIỀU tài xế, chưa thể xác định nguyên nhân chính xác từng người."
}

=== QUY TẮC VIẾT ===
- Viết bằng tiếng Việt, ngắn gọn, dễ hiểu cho người quản lý đọc.
- KHÔNG đề xuất hành động cụ thể như "phạt tài xế", "yêu cầu giải trình", "tạm ngưng thanh toán".
  Vì khu vực có NHIỀU tài xế khác nhau, AI chỉ phân tích tổng thể, KHÔNG thể kết luận cho từng cá nhân.
- Conclusion nên trung lập, khách quan, ví dụ: "Cần xem xét thêm dữ liệu cá nhân từng tài xế trước khi kết luận."
- KHÔNG dùng từ "chứng cứ", "chứng minh" — dùng "dữ liệu cho thấy", "ghi nhận".
"""


async def generate_diagnosis(h3_index: str, evidence: Evidence) -> DiagnosisResult:
    """
    Calls Groq API (or Gemini API, or uses rules fallback if API Key missing/fails)
    to generate grounded diagnosis based on 6 evidence dimensions.
    """
    telemetry = evidence.fleet_telemetry
    weather = evidence.weather
    news = evidence.news
    osrm_alts = evidence.osrm_alternatives
    driver_prof = evidence.driver_profile
    traffic = evidence.traffic_speed

    # Prepare evidence context prompt
    weather_time_str = weather.weather_time if (weather and weather.weather_time) else "N/A"
    user_prompt = f"""Hãy chẩn đoán điểm nóng ô H3 ({h3_index}) tại vị trí: {evidence.location_name}
Thời điểm chuyến xe/sự kiện: {evidence.target_time_str}

=== 6 NGUỒN BẰNG CHỨNG THỰC TẾ ===
1. Viễn thông đội xe (Mốc {evidence.target_time_str}):
   - Tổng số sự kiện lệch: {telemetry.total_events} | Số tài xế: {telemetry.unique_drivers} | Số chuyến đi: {telemetry.unique_trips}
   - Ngưỡng lệch mét động theo loại đường: {telemetry.dynamic_threshold_m}m
   - Tỷ lệ lệch thô: {telemetry.fleet_deviation_ratio * 100:.1f}% ({telemetry.high_dev_trips}/{telemetry.unique_trips} chuyến)
   - Tỷ lệ lệch ĐÃ LÀM MỊN BAYES: {telemetry.adjusted_deviation_ratio * 100:.1f}%
   - Khoảng tin cậy Wilson 95%: [{telemetry.wilson_lower_bound * 100:.1f}%, {telemetry.wilson_upper_bound * 100:.1f}%] (Biên sai số: ±{telemetry.margin_of_error * 100:.1f}%)
   - Vận tốc trung bình: {telemetry.avg_speed_kmh} km/h | Độ lệch TB: {telemetry.avg_deviation_m}m

2. Thời tiết (Mốc {weather_time_str}):
   - Tình trạng: {weather.description if weather else 'Không có dữ liệu'}
   - Nhiệt độ: {weather.temperature if weather else 'N/A'} °C | Mưa: {weather.rain_mm if weather else 0} mm/h | Gió: {weather.wind_speed if weather else 'N/A'} km/h

3. Tin tức & Sự kiện thực tế:
"""
    if news:
        for idx, item in enumerate(news, 1):
            user_prompt += f"   [{idx}] {item.title} ({item.source}) - {item.snippet}\n"
    else:
        user_prompt += "   (Không có bài báo ghi nhận sự kiện bất thường)\n"

    user_prompt += f"""
4. Lộ trình phụ OSRM:
   - Trạng thái: {osrm_alts.summary if osrm_alts else 'N/A'}
   - Phân loại: {osrm_alts.route_classification if osrm_alts else 'OSRM_UNAVAILABLE'} (Chênh lệch: {osrm_alts.distance_diff_meters if osrm_alts else 0}m, Tiết kiệm: {osrm_alts.best_time_saving_sec if osrm_alts else 0}s)
   - LƯU Ý: Nếu phân loại là OSRM_UNAVAILABLE, bạn BẮT BUỘC bỏ qua bằng chứng lộ trình OSRM và đánh giá dựa vào 5 bằng chứng còn lại.

5. Hồ sơ & Uy tín khu vực của Tài xế:
   - ID Tài xế: {driver_prof.driver_id if driver_prof else 'N/A'}
   - Tỷ lệ tuân thủ tuyến TRONG KHU VỰC: {driver_prof.compliance_rate_30d * 100:.1f}% ({driver_prof.deviated_trips_30d if driver_prof else 0}/{driver_prof.total_trips_30d if driver_prof else 0} chuyến lệch)
   - Mức độ uy tín: {driver_prof.reputation_level if driver_prof else 'EXCELLENT'}

6. Mật độ & Giới hạn Tốc độ Pháp lý:
   - Giới hạn tốc độ pháp lý con đường (OSM): {traffic.baseline_speed_kmh if traffic else 40} km/h | Vận tốc hiện tại: {traffic.current_speed_kmh if traffic else 40} km/h
   - Tỷ lệ sụt giảm tốc độ: {(traffic.speed_drop_ratio * 100):.1f}%
   - Trạng thái giao thông: {traffic.traffic_state if traffic else 'CLEAR'}
"""

    # Option 1: Call Groq API if GROQ_API_KEY is present
    # Tries models in cascade order — if a model is deprecated/unavailable, falls through to next
    if GROQ_API_KEY:
        groq_models = [
            "openai/gpt-oss-120b",  # Preferred: highest quality available on this key
            "openai/gpt-oss-20b",   # Fallback 1: faster, lighter
            "qwen/qwen3.6-27b",     # Fallback 2: Qwen multilingual (supports Vietnamese)
        ]
        for model_id in groq_models:
            for attempt in range(2):  # max 2 attempts per model for 429/503
                try:
                    url = "https://api.groq.com/openai/v1/chat/completions"
                    headers = {
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json",
                    }
                    payload = {
                        "model": model_id,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": user_prompt},
                        ],
                        "response_format": {"type": "json_object"},
                        "temperature": 0.1,
                    }

                    async with httpx.AsyncClient(timeout=25.0) as client:
                        resp = await client.post(url, json=payload, headers=headers)
                        if resp.status_code == 200:
                            data = resp.json()
                            content = data["choices"][0]["message"]["content"]
                            result_json = json.loads(content)
                            logger.info("[LLM Groq] Success with model: %s", model_id)
                            return DiagnosisResult(
                                h3_index=h3_index,
                                risk_level=result_json.get("risk_level", "SAFE_FORCE_MAJEURE"),
                                confidence=float(result_json.get("confidence", 0.95)),
                                observation=result_json.get("observation", ""),
                                context=result_json.get("context", ""),
                                conclusion=result_json.get("conclusion", ""),
                                evidence=evidence,
                            )
                        elif resp.status_code in (429, 503) and attempt < 1:
                            wait_sec = 2 ** attempt
                            logger.warning("[LLM Groq] %s: HTTP %d rate-limit — retry after %ds", model_id, resp.status_code, wait_sec)
                            await asyncio.sleep(wait_sec)
                            continue
                        elif resp.status_code == 404:
                            # Model deprecated or not found — try next model in cascade
                            logger.warning("[LLM Groq] Model %s not found (404) — trying next model", model_id)
                            break  # break attempt loop, continue outer groq_models loop
                        else:
                            logger.error("[LLM Groq] %s: HTTP %d: %s", model_id, resp.status_code, resp.text[:200])
                            break
                except Exception as e:
                    logger.error("[LLM Groq] %s: API call error on attempt %d: %s", model_id, attempt + 1, e)
                    break

    # Option 2: Attempt Gemini API call if GEMINI_API_KEY present
    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[SYSTEM_PROMPT, user_prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                )
            )

            if response and response.text:
                result_json = json.loads(response.text)
                return DiagnosisResult(
                    h3_index=h3_index,
                    risk_level=result_json.get("risk_level", "SAFE_FORCE_MAJEURE"),
                    confidence=float(result_json.get("confidence", 0.90)),
                    observation=result_json.get("observation", ""),
                    context=result_json.get("context", ""),
                    conclusion=result_json.get("conclusion", ""),
                    evidence=evidence,
                )
        except Exception as e:
            logger.error("[LLM Gemini] API call error: %s", e)

    # Option 3: Fallback reasoning logic if LLM APIs are unavailable or key not set
    return _rule_based_fallback(h3_index, evidence)

def _rule_based_fallback(h3_index: str, evidence: Evidence) -> DiagnosisResult:
    """Fast, accurate fallback diagnosis when LLM is unavailable."""
    telemetry = evidence.fleet_telemetry
    weather = evidence.weather
    news = evidence.news
    osrm_alts = evidence.osrm_alternatives
    driver_prof = evidence.driver_profile
    traffic = evidence.traffic_speed
    loc = evidence.location_name or "khu vực này"

    rain = weather.rain_mm if (weather and weather.rain_mm is not None) else 0.0
    ratio = telemetry.adjusted_deviation_ratio if telemetry.adjusted_deviation_ratio > 0 else telemetry.fleet_deviation_ratio
    has_news = len(news) > 0
    is_gridlock = traffic and traffic.traffic_state == "SEVERE_GRIDLOCK"
    is_shortcut = osrm_alts and osrm_alts.route_classification == "OPTIMIZED_SHORTCUT"
    pct = round(ratio * 100, 1)

    # Common observation
    observation = f"Ghi nhận {telemetry.unique_drivers} tài xế đi qua {loc}, trong đó {pct}% chuyến lệch khỏi tuyến tiêu chuẩn ({telemetry.high_dev_trips}/{telemetry.unique_trips} chuyến)."

    if rain >= 10.0 or has_news or is_gridlock or is_shortcut:
        risk = "SAFE_FORCE_MAJEURE"
        conf = 0.95 if telemetry.margin_of_error <= 0.25 else 0.75
        ctx_parts = []
        if rain >= 10.0:
            ctx_parts.append(f"mưa lớn {rain}mm/h")
        if is_gridlock:
            drop = round((traffic.speed_drop_ratio if traffic else 0.8) * 100)
            ctx_parts.append(f"kẹt xe nghiêm trọng (tốc độ giảm {drop}%)")
        if has_news:
            ctx_parts.append(f"có sự kiện giao thông được ghi nhận")
        if is_shortcut:
            ctx_parts.append("tuyến rẽ được OSRM xác nhận là đường tắt tối ưu hơn")
        context = f"Dữ liệu cho thấy có yếu tố khách quan: {', '.join(ctx_parts)}."
        conclusion = "Việc lệch tuyến có nguyên nhân khách quan rõ ràng, phù hợp với điều kiện thực tế tại thời điểm đó."
    elif (osrm_alts and osrm_alts.route_classification == "INFLATED_DETOUR") or (
        driver_prof and driver_prof.reputation_level == "HIGH_RISK" and ratio >= 0.4
        and (not osrm_alts or osrm_alts.route_classification not in ("OPTIMIZED_SHORTCUT", "OSRM_UNAVAILABLE"))
    ):
        risk = "FRAUD_ALERT"
        conf = 0.92 if telemetry.margin_of_error <= 0.25 else 0.70
        weather_desc = weather.description if weather else "không rõ"
        traffic_desc = "thông thoáng" if (not traffic or traffic.traffic_state == "CLEAR") else traffic.traffic_state
        context = f"Thời tiết {weather_desc} ({rain}mm/h), giao thông {traffic_desc}. Không ghi nhận sự kiện bất thường nào giải thích cho mức lệch tuyến cao."
        conclusion = f"Tỷ lệ lệch tuyến cao bất thường trong điều kiện bình thường. Tuy nhiên, đây là dữ liệu tổng hợp của {telemetry.unique_drivers} tài xế — cần xem xét từng trường hợp cụ thể."
    else:
        risk = "SUSPICIOUS"
        conf = 0.75 if telemetry.margin_of_error <= 0.25 else 0.60
        weather_desc = weather.description if weather else "không rõ"
        context = f"Thời tiết {weather_desc} ({rain}mm/h), giao thông bình thường. Chưa đủ dữ liệu để xác định rõ nguyên nhân."
        conclusion = f"Mức lệch tuyến đáng chú ý nhưng chưa đủ dấu hiệu để kết luận. Cần theo dõi thêm xu hướng tại khu vực này."

    return DiagnosisResult(
        h3_index=h3_index,
        risk_level=risk,
        confidence=conf,
        observation=observation,
        context=context,
        conclusion=conclusion,
        evidence=evidence,
    )
