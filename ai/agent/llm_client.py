import os
import json
import httpx
from typing import Optional
from models import Evidence, DiagnosisResult

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Bạn là Chuyên gia Phân tích Giao thông & Điều tra Hành vi Đội xe (AI Fleet Investigator).
Nhiệm vụ của bạn là nhận dữ liệu bằng chứng thực tế (Real-World Evidence) bao gồm:
1. Dữ liệu viễn thông đội xe (Fleet Telemetry từ PostgreSQL)
2. Thời tiết thực tế (từ Open-Meteo API)
3. Tin tức & Sự kiện giao thông địa phương (từ DuckDuckGo Search)
4. Địa danh vị trí (từ OpenStreetMap Nominatim)

Nhiệm vụ: Phân tích các bằng chứng này để đưa ra chẩn đoán chính xác 100% nguyên nhân né tránh/lệch đường.

Quy tắc phân loại rủi ro (risk_level):
- "SAFE_FORCE_MAJEURE": Nếu bẻ lái do bất khả kháng (Mưa to >20mm/h, Ngập nước, Tai nạn, Sạt lở, Thi công, Chốt giao thông). Tỷ lệ đội xe cùng rẽ > 50%.
- "SUSPICIOUS": Nếu chỉ có 1-2 xe bẻ lái, không có mưa ngập hay sự kiện bất thường. Cần theo dõi.
- "FRAUD_ALERT": Nếu tài xế cố tình chạy lòng vòng kéo dài quãng đường cước bất hợp lý (>1km) mà thời tiết & giao thông bình thường.

Yêu cầu output: Trả về BẮT BUỘC theo đúng định dạng JSON có cấu trúc sau:
{
  "risk_level": "SAFE_FORCE_MAJEURE" | "SUSPICIOUS" | "FRAUD_ALERT",
  "confidence": 0.95,
  "summary": "Tóm tắt chẩn đoán bằng tiếng Việt 2-3 câu ngắn gọn, nêu rõ lý do thực tế.",
  "recommendation": "Đề xuất hành động cụ thể cho Admin (ví dụ: 'Tạm thời bypass OSRM 2 giờ', 'Không phạt tài xế', hoặc 'Gửi cảnh báo kiểm tra tài xế')."
}
"""

async def generate_diagnosis(h3_index: str, evidence: Evidence) -> DiagnosisResult:
    """
    Calls Groq API (or Gemini API, or uses rules fallback if API Key missing/fails)
    to generate grounded diagnosis.
    """
    telemetry = evidence.fleet_telemetry
    weather = evidence.weather
    news = evidence.news

    # Prepare evidence context prompt
    weather_time_str = weather.weather_time if (weather and weather.weather_time) else "N/A"
    user_prompt = f"""Hãy chẩn đoán điểm nóng ô H3 ({h3_index}) tại vị trí: {evidence.location_name}
Thời điểm chuyến xe/sự kiện: {evidence.target_time_str}

=== BẰNG CHỨNG THỰC TẾ ===
1. Viễn thông đội xe (tại mốc thời gian {evidence.target_time_str}):
   - Tổng số sự kiện lệch: {telemetry.total_events}
   - Số tài xế ảnh hưởng: {telemetry.unique_drivers}
   - Tỷ lệ đội xe cùng bẻ lái: {telemetry.fleet_deviation_ratio * 100:.1f}% ({telemetry.high_dev_trips}/{telemetry.unique_trips} chuyến)
   - Vận tốc trung bình: {telemetry.avg_speed_kmh} km/h
   - Độ lệch trung bình: {telemetry.avg_deviation_m}m

2. Thời tiết (Mốc thời gian: {weather_time_str}):
   - Tình trạng: {weather.description if weather else 'Không có dữ liệu'}
   - Nhiệt độ: {weather.temperature if weather else 'N/A'} °C
   - Lượng mưa: {weather.rain_mm if weather else 0} mm/h
   - Sức gió: {weather.wind_speed if weather else 'N/A'} km/h

3. Tin tức & Sự kiện thực tế:
"""
    if news:
        for idx, item in enumerate(news, 1):
            user_prompt += f"   [{idx}] {item.title} ({item.source}) - {item.snippet}\n"
    else:
        user_prompt += "   (Không có bài báo ghi nhận sự kiện bất thường)\n"

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
                "temperature": 0.2,
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
                    temperature=0.2,
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

    rain = weather.rain_mm if (weather and weather.rain_mm is not None) else 0.0
    ratio = telemetry.fleet_deviation_ratio
    has_news = len(news) > 0

    if (rain >= 10.0 or has_news):
        risk = "SAFE_FORCE_MAJEURE"
        conf = 0.92
        reasons = []
        if rain >= 10.0:
            reasons.append(f"mưa lớn ({rain}mm/h)")
        if has_news:
            reasons.append(f"tin tức giao thông '{news[0].title[:40]}...'")

        reason_str = ", ".join(reasons)
        summary = f"Tài xế né tránh hợp lý do {reason_str} tại {evidence.location_name}. Đây là tình huống bất khả kháng."
        rec = "Tạm thời cập nhật OSRM bypass đoạn đường này. KHÔNG phạt tài xế."
    elif ratio >= 0.5:
        risk = "FRAUD_ALERT"
        conf = 0.88
        pct = round(ratio * 100, 1)
        summary = f"Phát hiện tỷ lệ bẻ lái cao bất thường ({pct}% · {telemetry.high_dev_trips}/{telemetry.unique_trips} chuyến) tại {evidence.location_name} nhưng thời tiết khô ráo, không ghi nhận ngập lụt hay kẹt xe."
        rec = "Gửi thông báo cảnh báo kiểm tra hành vi bẻ lái của các tài xế trong khu vực này."
    elif ratio >= 0.2:
        risk = "SUSPICIOUS"
        conf = 0.75
        pct = round(ratio * 100, 1)
        summary = f"Ghi nhận {telemetry.high_dev_trips} chuyến bẻ lái ({pct}%) tại {evidence.location_name} chưa rõ nguyên nhân. Thời tiết bình thường."
        rec = "Theo dõi thêm biến động trong 30 phút tới."
    else:
        risk = "SUSPICIOUS"
        conf = 0.70
        summary = f"Khu vực {evidence.location_name} ghi nhận ít bẻ lái ({telemetry.high_dev_trips}/{telemetry.unique_trips} chuyến). Thời tiết ráo mát."
        rec = "Không cần xử lý."

    return DiagnosisResult(
        h3_index=h3_index,
        risk_level=risk,
        confidence=conf,
        summary=summary,
        evidence=evidence,
        recommendation=rec,
    )
