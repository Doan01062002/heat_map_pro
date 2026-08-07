import httpx
import asyncio
import xml.etree.ElementTree as ET
from urllib.parse import quote
from typing import List, Optional
from models import NewsItem
from duckduckgo_search import DDGS

async def search_incidents(lat: float, lng: float, location_name: str, timestamp_ms: Optional[int] = None) -> List[NewsItem]:
    """
    Search real-world traffic incidents, flooding, landslides, road closures, or events
    near the specified location using Google News RSS and DuckDuckGo Search.
    100% Free, no API key required.
    Timeout: 4 seconds.
    """
    location_short = location_name.split(",")[0] if "," in location_name else location_name
    query_str = f"{location_short} traffic incident road closure flood"

    results: List[NewsItem] = []

    # Provider 1: Google News RSS Feed (Ultra reliable, zero rate-limits)
    try:
        encoded_query = quote(query_str)
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"

        async with httpx.AsyncClient(timeout=3.5, follow_redirects=True) as client:
            resp = await client.get(rss_url)
            if resp.status_code == 200 and resp.text:
                root = ET.fromstring(resp.text)
                items = root.findall(".//item")
                for item in items[:4]:
                    title_elem = item.find("title")
                    link_elem = item.find("link")
                    pub_elem = item.find("pubDate")

                    title = title_elem.text if title_elem is not None else ""
                    link = link_elem.text if link_elem is not None else ""
                    pub = pub_elem.text if pub_elem is not None else ""

                    if title:
                        results.append(NewsItem(
                            title=title,
                            source=f"Google News ({pub[:16]})" if pub else "Google News",
                            url=link,
                            snippet=f"Sự kiện tin tức ghi nhận tại khu vực {location_short}.",
                        ))
    except Exception as e:
        print(f"[Tool: NewsSearch Google RSS Error] {e}")

    # If Provider 1 found items, return immediately
    if results:
        return results

    # Provider 2: DuckDuckGo Search (Fallback)
    def _ddg_sync():
        ddg_results = []
        try:
            with DDGS() as ddgs:
                news_gen = ddgs.text(f"{location_short} traffic incident", max_results=3)
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
