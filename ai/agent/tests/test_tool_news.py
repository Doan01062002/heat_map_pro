import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.news_search import search_incidents, normalize_location_entity, is_within_temporal_window

async def test_news_tool():
    print("------------ [TOOL TEST 3] news_search.py ------------")
    # Test entity normalization
    cleaned, lang, keywords = normalize_location_entity("Rua do Doutor Magalhães Lemos, Porto")
    print(f"  • Entity Normalization : '{cleaned}' (Lang: {lang})")
    print(f"  • Search Keywords      : {keywords}")
    assert lang == "pt", "Porto location should detect Portuguese language mode"

    # Test temporal window filter (+-48h)
    in_window = is_within_temporal_window("Mon, 01 Jul 2013 12:00:00 GMT", 1372694282000, max_window_hours=48)
    out_window = is_within_temporal_window("Wed, 01 Jul 2026 12:00:00 GMT", 1372694282000, max_window_hours=48)
    
    print(f"  • Filter Test (+-48h Same Date 2013) : {in_window}")
    print(f"  • Filter Test (+-48h Wrong Year 2026): {out_window}")

    assert in_window == True, "2013 article should be within 2013 window"
    assert out_window == False, "2026 article should be rejected for 2013 window"

    print("✅ PASSED: news_search.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_news_tool())
