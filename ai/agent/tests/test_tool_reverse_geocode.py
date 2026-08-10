import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.reverse_geocode import reverse_geocode, _LOCATION_CACHE

async def test_reverse_geocode_tool():
    print("------------ [TOOL TEST 4] reverse_geocode.py ------------")
    # Test 1: First call (Populates Cache & Infrastructure Tag)
    name1 = await reverse_geocode(41.14780, -8.61071)
    print(f"  • Call 1 (Nominatim API) : {name1}")
    assert len(name1) > 0, "Location name should not be empty"

    # Test 2: Second call (Reads from LRU Cache in 0.0001s)
    cache_key = (round(41.14780, 4), round(-8.61071, 4))
    print(f"  • Cache Key Verified     : {cache_key} in _LOCATION_CACHE -> {cache_key in _LOCATION_CACHE}")
    assert cache_key in _LOCATION_CACHE, "Location should be stored in LRU memory cache"

    name2 = await reverse_geocode(41.14780, -8.61071)
    print(f"  • Call 2 (LRU Cache RAM) : {name2}")
    assert name1 == name2, "Cached location name should match"

    print("✅ PASSED: reverse_geocode.py Standalone Test\n")

if __name__ == "__main__":
    asyncio.run(test_reverse_geocode_tool())
