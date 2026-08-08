import os
import json
import httpx
from typing import Optional
from models import Evidence, DiagnosisResult

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Bạn là Chuyên gia Phân tích Giao thông & Điều tra Hành vi Đội xe Chuyên nghiệp (AI Fleet Investigator Pro).
Nhiệm vụ của bạn là nhận dữ liệu bằng chứng thực tế (Real-World Evidence) từ 6 NGUỒN BẰNG CHỨNG ĐÓNG GÓI:
1. Viễn thông đội xe (Fleet Telemetry từ PostgreSQL - Đã làm mịn Bayes & Tính Khoảng Tin cậy Wilson 95%)
2. Lịch sử & Thời tiết thực tế (Open-Meteo Historical Archive / Forecast API)
3. Tin tức & Sự kiện giao thông địa phương (Google News RSS Feed & DuckDuckGo Search)
4. Phân tích Lộ trình phụ OSRM (Alternative Route Analysis: Đường tắt tối ưu vs Rẽ lòng vòng)
5. Hồ sơ Uy tín 30 ngày của Tài xế (Driver 30-day System-wide Compliance & Reputation)
6. Mật độ & Giới hạn Tốc độ Pháp lý (Authoritative Speed Limit & Gridlock Ratio từ OpenStreetMap)

=== QUY TẮC NGUYÊN TẮC PHÂN LOẠI RỦI RO (RISK HIERARCHY - BẮT BUỘC THÂN THEO 100%) ===

1. KẾT LUẬN "SAFE_FORCE_MAJEURE" (🟢 An toàn - Bất khả kháng / Lộ trình tối ưu):
   - KHI Mưa lớn >= 10mm/h HOẶC Tin tức có ghi nhận ngập lụt, sạt lở, tai nạn, cấm đường, thi công.
   - HOẶC Giao thông kẹt xe nghiêm trọng (Sụt giảm vận tốc >= 65% so với giới hạn pháp lý).
   - HOẶC Lộ trình OSRM thay thế là OPTIMIZED_SHORTCUT (Tiết kiệm thời gian di chuyển >60 giây).
   - HOẶC Tỷ lệ đội xe cùng bẻ lái (Đã làm mịn Bayes) >= 50% VÀ Nhóm tài xế có uy tín khu vực tốt (Compliance >= 85%).

2. KẾT LUẬN "FRAUD_ALERT" (🔴 Cảnh báo Gian lận Cố ý):
   - KHI Lộ trình OSRM thay thế là INFLATED_DETOUR (Tài xế rẽ lòng vòng kéo dài quãng đường >1.5km & tốn thêm thời gian bất hợp lý).
   - HOẶC Tài xế/Nhóm tài xế có tỷ lệ vi phạm khu vực cao (Compliance < 70%, HIGH_RISK) VÀ Thời tiết ráo mát (<5mm/h), không kẹt xe, không sự kiện giao thông.
   - Nếu OSRM_UNAVAILABLE: không được dùng OSRM để chứng minh FRAUD_ALERT. Dựa vào Telemetry, Weather, Driver Profile, Traffic.

3. KẾT LUẬN "SUSPICIOUS" (🟡 Cần Theo dõi Nghi vấn):
   - KHI Bẻ lái rải rác (15% - 50%), thời tiết & giao thông bình thường, chưa đủ bằng chứng kết luận bất khả kháng hay gian lận cố ý.
   - HOẶC OSRM_UNAVAILABLE và không đủ bằng chứng từ 5 nguồn còn lại để kết luận chắc chắn.

=== QUY TẮC XỬ LÝ MẪU ÍT & BIÊN ĐỘ SAI SỐ THỐNG KÊ (WILSON MARGIN OF ERROR) ===
- Nếu Biên độ Sai số Thống kê (margin_of_error) > 0.25 (do số mẫu ít unique_trips < 5), AI BẮT BUỘC phải hạ độ tin cậy "confidence" xuống <= 0.75 và nêu rõ trong "summary": "Tỷ lệ bẻ lái đã được làm mịn Bayes (chỉ số adjusted_ratio) do cỡ mẫu nhỏ."

Yêu cầu output: Trả về BẮT BUỘC theo đúng định dạng JSON có cấu trúc sau:
{
  "risk_level": "SAFE_FORCE_MAJEURE" | "SUSPICIOUS" | "FRAUD_ALERT",
  "confidence": 0.95,
  "summary": "Tóm tắt chẩn đoán bằng tiếng Việt 2-3 câu chặt chẽ, trích dẫn đầy đủ số liệu chứng cứ.",
  "recommendation": "Đề xuất hành động cụ thể cho Admin (ví dụ: 'Tạm thời bypass OSRM 2 giờ', 'Không phạt tài xế', hoặc 'Gửi cảnh báo kiểm tra tài xế và yêu cầu giải trình cước')."
}
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

    # Option 1: Call Groq API if GROQ_API_KEY is present (Ultra fast LLaMA 3.3 70B)
    if GROQ_API_KEY:
        try:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.1,
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    result_json = json.loads(content)

                    return DiagnosisResult(
                        h3_index=h3_index,
                        risk_level=result_json.get("risk_level", "SAFE_FORCE_MAJEURE"),
                        confidence=float(result_json.get("confidence", 0.95)),
                        summary=result_json.get("summary", "Đã phân tích bằng chứng thực tế qua Groq AI."),
                        evidence=evidence,
                        recommendation=result_json.get("recommendation", "Theo dõi khu vực."),
                    )
                else:
                    print(f"[LLM Client] Groq HTTP {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[LLM Client] Groq API call error: {e}")

    # Option 2: Attempt Gemini API call if GEMINI_API_KEY present
    if GEMINI_API_KEY:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model="gemini-2.5-flash",
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
                    summary=result_json.get("summary", "Đã phân tích bằng chứng thực tế qua Gemini AI."),
                    evidence=evidence,
                    recommendation=result_json.get("recommendation", "Theo dõi khu vực."),
                )
        except Exception as e:
            print(f"[LLM Client] Gemini API call error: {e}")

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

    rain = weather.rain_mm if (weather and weather.rain_mm is not None) else 0.0
    ratio = telemetry.adjusted_deviation_ratio if telemetry.adjusted_deviation_ratio > 0 else telemetry.fleet_deviation_ratio
    has_news = len(news) > 0
    is_gridlock = traffic and traffic.traffic_state == "SEVERE_GRIDLOCK"
    is_shortcut = osrm_alts and osrm_alts.route_classification == "OPTIMIZED_SHORTCUT"

    if rain >= 10.0 or has_news or is_gridlock or is_shortcut:
        risk = "SAFE_FORCE_MAJEURE"
        conf = 0.95 if telemetry.margin_of_error <= 0.25 else 0.75
        reasons = []
        if rain >= 10.0:
            reasons.append(f"mưa lớn ({rain}mm/h)")
        if has_news:
            reasons.append(f"tin tức giao thông '{news[0].title[:35]}...'")
        if is_gridlock:
            reasons.append(f"kẹt xe nghiêm trọng (tốc độ giảm {round((traffic.speed_drop_ratio if traffic else 0.8)*100)}%)")
        if is_shortcut:
            reasons.append("lộ trình rẽ là đường tắt tối ưu thời gian di chuyển hơn")

        reason_str = ", ".join(reasons)
        summary = f"Tài xế né tránh hợp lý tại {evidence.location_name} do {reason_str}."
        rec = "Tạm thời cập nhật OSRM bypass đoạn đường này. KHÔNG phạt tài xế."
    elif (osrm_alts and osrm_alts.route_classification == "INFLATED_DETOUR") or (
        driver_prof and driver_prof.reputation_level == "HIGH_RISK" and ratio >= 0.4
        and (not osrm_alts or osrm_alts.route_classification not in ("OPTIMIZED_SHORTCUT", "OSRM_UNAVAILABLE"))
    ):
        risk = "FRAUD_ALERT"
        conf = 0.92 if telemetry.margin_of_error <= 0.25 else 0.70
        pct = round(ratio * 100, 1)
        summary = f"Cảnh báo nghi vấn gian lận tại {evidence.location_name}: Phát hiện rẽ đường lòng vòng kéo dài quãng đường ({pct}% bẻ lái đã làm mịn) trong điều kiện giao thông khô ráo bình thường."
        rec = "Gửi thông báo yêu cầu tài xế xác nhận lý do bẻ lái và kiểm tra cước chuyến đi."
    else:
        risk = "SUSPICIOUS"
        conf = 0.75 if telemetry.margin_of_error <= 0.25 else 0.60
        pct = round(ratio * 100, 1)
        summary = f"Ghi nhận {telemetry.high_dev_trips} chuyến bẻ lái ({pct}% đã làm mịn Bayes, biên sai số ±{round(telemetry.margin_of_error*100, 1)}%) tại {evidence.location_name}. Thời tiết và giao thông bình thường."
        rec = "Theo dõi thêm biến động trong 30 phút tới."

    return DiagnosisResult(
        h3_index=h3_index,
        risk_level=risk,
        confidence=conf,
        summary=summary,
        evidence=evidence,
        recommendation=rec,
    )
