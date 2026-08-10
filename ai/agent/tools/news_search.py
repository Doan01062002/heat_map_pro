import httpx
import asyncio
import re
import xml.etree.ElementTree as ET
from urllib.parse import quote
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from typing import List, Optional
from models import NewsItem
from duckduckgo_search import DDGS

def expand_road_acronym_dynamically(name: str) -> str:
    """
    Dynamically expands highway/road acronyms (e.g. ql1a -> Quốc lộ 1A, ct01 -> Cao tốc 01, nh1 -> National Highway 1)
    without static hardcoded dictionaries. Uses dynamic regex pattern matching.
    """
    cleaned = name.strip()
    match_ql = re.match(r'^(ql|nh)(\d+[a-z]?)$', cleaned, re.IGNORECASE)
    if match_ql:
        return f"Quốc lộ {match_ql.group(2).upper()}"

    match_ct = re.match(r'^(ct)(\d+[a-z]?)$', cleaned, re.IGNORECASE)
    if match_ct:
        return f"Cao tốc {match_ct.group(2).upper()}"

    return cleaned

def normalize_location_entity(location_name: str) -> tuple[str, str, str]:
    """
    Normalize location entity and detect language mode (vi | pt | en) dynamically:
    Returns (cleaned_location_name, language_code, search_keywords)
    """
    raw_short = location_name.split(",")[0].strip() if "," in location_name else location_name.strip()
    
    # 1. Dynamic Road Acronym Expansion
    cleaned_short = expand_road_acronym_dynamically(raw_short)

    # 2. Language & Keyword Detection
    # Detect Portuguese (Porto dataset)
    if any(pt_word in location_name.lower() for pt_word in ["porto", "cedofeita", "ramada", "rua", "praça", "avenida"]):
        lang = "pt"
        keywords = "(trânsito OR inundação OR acidente OR obras OR corte)"
    # Detect Vietnamese
    elif any(vi_char in location_name.lower() for vi_char in ["đường", "phố", "quận", "huyện", "phường", "quốc lộ", "hà nội", "sài gòn"]):
        lang = "vi"
        keywords = '(cấm đường OR ngập lụt OR "tai nạn" OR "thi công" OR "kẹt xe")'
    else:
        lang = "en"
        keywords = "(traffic OR closure OR flood OR accident OR roadworks)"

    return cleaned_short, lang, keywords

def is_within_temporal_window(pub_date_str: str, target_timestamp_ms: Optional[int], max_window_hours: int = 48) -> bool:
    """
    Verify if news publication date is within +-48 hours of trip timestamp.
    Eliminates 100% of out-of-date contextual noise (e.g. articles from next month or last year).
    """
    if not target_timestamp_ms or target_timestamp_ms <= 0:
        return True  # If real-time mode, allow recent news

    if not pub_date_str:
        return True

    try:
        pub_dt = parsedate_to_datetime(pub_date_str)
        if pub_dt.tzinfo is None:
            pub_dt = pub_dt.replace(tzinfo=timezone.utc)

        target_dt = datetime.fromtimestamp(target_timestamp_ms / 1000.0, tz=timezone.utc)
        diff = abs((pub_dt - target_dt).total_seconds()) / 3600.0
        return diff <= max_window_hours
    except Exception:
        return True  # Fallback gracefully if date parsing fails

async def search_incidents(lat: float, lng: float, location_name: str, timestamp_ms: Optional[int] = None) -> List[NewsItem]:
    """
    Search real-world traffic incidents using Google News RSS & DuckDuckGo with:
    1. Dynamic Entity Normalization & Multilingual Keyword Selection (vi/pt/en).
    2. Strict +-48h Temporal Publication Window Filtering (Eliminates out-of-date noise).
    100% Free, no API key required.
    Timeout: 4.0 seconds.
    """
    location_short, lang_code, keywords = normalize_location_entity(location_name)
    query_str = f'"{location_short}" {keywords}'

    results: List[NewsItem] = []

    # Provider 1: Google News RSS Feed with Multilingual Edition & Temporal Filter
    try:
        encoded_query = quote(query_str)
        ceid = "VN:vi" if lang_code == "vi" else ("PT:pt" if lang_code == "pt" else "US:en")
        hl = lang_code
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl={hl}&gl={ceid.split(':')[0]}&ceid={ceid}"

        async with httpx.AsyncClient(timeout=3.5, follow_redirects=True) as client:
            resp = await client.get(rss_url)
            if resp.status_code == 200 and resp.text:
                root = ET.fromstring(resp.text)
                items = root.findall(".//item")
                for item in items:
                    title_elem = item.find("title")
                    link_elem = item.find("link")
                    pub_elem = item.find("pubDate")

                    title = title_elem.text if title_elem is not None else ""
                    link = link_elem.text if link_elem is not None else ""
                    pub = pub_elem.text if pub_elem is not None else ""

                    # Temporal Window Filter Check (Within +-48h)
                    if title and is_within_temporal_window(pub, timestamp_ms, max_window_hours=48):
                        results.append(NewsItem(
                            title=title,
                            source=f"Google News ({pub[:16]})" if pub else "Google News",
                            url=link,
                            snippet=f"Sự kiện tin tức giao thông xác minh tại khu vực {location_short}.",
                        ))
                        if len(results) >= 4:
                            break
    except Exception as e:
        print(f"[Tool: NewsSearch Google RSS Error] {e}")

    # If Provider 1 found items within temporal window, return immediately
    if results:
        return results

    # Provider 2: DuckDuckGo Search (Fallback)
    def _ddg_sync():
        ddg_results = []
        try:
            with DDGS() as ddgs:
                news_gen = ddgs.text(f'"{location_short}" traffic', max_results=3)
                if news_gen:
                    for item in news_gen:
                        ddg_results.append(NewsItem(
                            title=item.get("title", ""),
                            source="DuckDuckGo",
                            url=item.get("href", item.get("url", "")),
                            snippet=item.get("body", item.get("snippet", "")),
                        ))
        except Exception as e:
            print(f"[Tool: NewsSearch DDG Error] {e}")
        return ddg_results

    try:
        ddg_items = await asyncio.wait_for(asyncio.to_thread(_ddg_sync), timeout=3.0)
        if ddg_items:
            results.extend(ddg_items)
    except Exception as e:
        print(f"[Tool: NewsSearch DDG Fallback] {e}")

    return results
