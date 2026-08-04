# Algorithm Specifications — Real-Time Driver Deviation Heatmap

> Detailed algorithmic design for each processing stage in the deviation detection pipeline.

---

## 1. Bounding Box Pre-Filter

### Problem
Sending every GPS point to OSRM C++ for map-matching wastes CPU. Most points are on-route and don't need verification.

### Algorithm

When a trip is registered (via `POST /api/trips`), compute a **bounding box** around the planned route with a configurable buffer (default: 50 meters).

```
Input:  waypoints[] — ordered list of (lat, lng) from planned route
Output: BoundingBox { min_lat, min_lng, max_lat, max_lng }

Algorithm ComputeBoundingBox(waypoints, buffer_meters):
    min_lat = MIN(waypoints[*].lat)
    max_lat = MAX(waypoints[*].lat)
    min_lng = MIN(waypoints[*].lng)
    max_lng = MAX(waypoints[*].lng)

    // Convert buffer from meters to degrees (approximate)
    // 1 degree latitude ≈ 111,320 meters
    // 1 degree longitude ≈ 111,320 * cos(latitude) meters
    lat_buffer = buffer_meters / 111320.0
    lng_buffer = buffer_meters / (111320.0 * cos(radians((min_lat + max_lat) / 2)))

    return BoundingBox {
        min_lat: min_lat - lat_buffer,
        min_lng: min_lng - lng_buffer,
        max_lat: max_lat + lat_buffer,
        max_lng: max_lng + lng_buffer,
    }
```

### Runtime Check (per GPS point)

```
Input:  point(lat, lng), bbox
Output: bool (true = inside bbox = likely safe, false = outside = suspect)

Algorithm IsInsideBBox(point, bbox):
    return point.lat >= bbox.min_lat
        && point.lat <= bbox.max_lat
        && point.lng >= bbox.min_lng
        && point.lng <= bbox.max_lng
```

**Complexity:** O(1) per point.
**Expected filter rate:** ~70% of points pass (inside bbox = safe, skip OSRM).

### Limitation
A bounding box is coarse — a driver could be inside the bbox but still far from the actual route. That's why points inside the bbox are treated as "likely safe" for this demo. A production system might use a polyline distance check instead.

---

## 2. OSRM Map-Matching Integration

### Problem
For GPS points that fail the bounding box check (suspect deviations), we need precise road-network matching.

### OSRM Match API

```
GET /match/v1/driving/{lng1},{lat1};{lng2},{lat2};...?
    geometries=geojson&
    overview=simplified&
    timestamps={t1};{t2};...&
    radiuses={r1};{r2};...
```

**Key parameters:**
| Parameter    | Value     | Purpose                                    |
| ------------ | --------- | ------------------------------------------ |
| `geometries` | `geojson` | Return matched route as GeoJSON            |
| `overview`   | `simplified` | Simplified geometry (less data)          |
| `timestamps` | Unix seconds | Helps HMM algorithm determine speed     |
| `radiuses`   | `50`      | Search radius in meters per point          |

### Deviation Detection Algorithm

```
Input:  suspect_point(lat, lng), trip_planned_route
Output: (is_deviated: bool, distance_meters: float)

Algorithm CheckDeviation(suspect_point, planned_route_segment):
    // 1. Send suspect point + nearest 2 planned points to OSRM /match
    nearby_planned = FindNearestPlannedPoints(suspect_point, planned_route, count=2)
    
    coordinates = [suspect_point, nearby_planned[0], nearby_planned[1]]
    
    response = OSRM_Match(coordinates)
    
    // 2. Check if OSRM matched the suspect point to the road network
    if response.tracepoints[0] == null:
        // Point couldn't be matched to any road — definite deviation
        return (true, Infinity)
    
    matched_point = response.tracepoints[0].location  // (lng, lat)
    
    // 3. Calculate distance between original GPS point and OSRM's matched position
    distance = HaversineDistance(suspect_point, matched_point)
    
    // 4. Compare with planned route
    // If the matched road is the planned road, distance is just GPS noise
    // If the matched road is DIFFERENT from the planned road, it's a deviation
    planned_distance = MinDistanceToPolyline(matched_point, planned_route)
    
    is_deviated = planned_distance > DEVIATION_THRESHOLD_METERS  // default: 50m
    
    return (is_deviated, planned_distance)
```

### Haversine Distance Formula

```
Input:  point_a(lat1, lng1), point_b(lat2, lng2)
Output: distance in meters

Algorithm HaversineDistance(a, b):
    R = 6371000  // Earth radius in meters
    φ1 = radians(a.lat)
    φ2 = radians(b.lat)
    Δφ = radians(b.lat - a.lat)
    Δλ = radians(b.lng - a.lng)

    h = sin²(Δφ/2) + cos(φ1) * cos(φ2) * sin²(Δλ/2)
    c = 2 * atan2(√h, √(1-h))

    return R * c
```

### OSRM Client Design

- **Timeout:** 500ms max. If OSRM doesn't respond, log the timeout and skip (don't block the pipeline).
- **Connection pooling:** Use Go's `http.Transport` with `MaxIdleConnsPerHost=10`.
- **Error handling:** On OSRM error, increment an error counter metric. Do NOT crash.

---

## 3. H3 Spatial Indexing

### Problem
Raw GPS coordinates are individual points. We need to aggregate them into spatial regions for the heatmap.

### Uber H3 Algorithm

H3 divides the world into a hierarchical grid of hexagonal cells. We use **Resolution 8** (~460m diameter).

```
Input:  (latitude, longitude)
Output: H3 cell index string (e.g., "882830828bfffff")

Algorithm LatLngToH3(lat, lng, resolution=8):
    // Internally uses icosahedron face projection
    // O(1) computation — no network, no lookup table
    return h3.LatLngToCell(h3.NewLatLng(lat, lng), resolution)
```

### Why Resolution 8?

| Resolution | Hex Diameter | Hex Area   | Use Case                    |
| ---------- | ------------ | ---------- | --------------------------- |
| 7          | ~1.2 km      | ~5.16 km²  | Too coarse, loses detail    |
| **8**      | **~460 m**   | **0.74 km²** | **Good for city blocks**  |
| 9          | ~174 m       | ~0.11 km²  | Too fine, too many cells    |

Resolution 8 balances detail (can see individual intersections) with data volume (manageable cell count for a city).

### Data Reduction

| Metric                 | Raw GPS Points | H3 Cells (Res 8) | Reduction |
| ---------------------- | -------------- | ----------------- | --------- |
| HCMC city area         | ~1M points     | ~3,000 cells      | 99.7%     |
| Data per WS update     | ~500 KB        | ~10 KB            | 98%       |

---

## 4. Lock-Free In-Memory Aggregation

### Problem
Thousands of goroutines (one per driver connection) need to increment deviation counters for H3 cells concurrently. Using `sync.Mutex` would create a bottleneck.

### Lock-Free Algorithm

```go
// Data structure (conceptual)
type Aggregator struct {
    cells sync.Map  // map[string]*uint64   (H3 index → deviation count)
}

Algorithm IncrementCell(h3_index):
    // 1. Load or store a new counter atomically
    val, loaded = cells.LoadOrStore(h3_index, new(uint64))
    
    if loaded:
        counter = val.(*uint64)
    else:
        counter = val.(*uint64)  // freshly stored
    
    // 2. Atomically increment the counter (no lock needed)
    atomic.AddUint64(counter, 1)
    
    // No mutex, no lock, no contention.
    // Multiple goroutines can increment different cells in parallel.
    // Same-cell increments use CPU-level atomic CAS instructions.
```

### Batch Flush (Snapshot & Reset)

Every 1 second, a background goroutine takes a **snapshot** of all counters and resets them:

```
Algorithm FlushSnapshot():
    snapshot = empty map[string]uint64
    
    cells.Range(func(key, value):
        h3_index = key.(string)
        counter = value.(*uint64)
        
        // Atomically swap the counter to 0 and read old value
        count = atomic.SwapUint64(counter, 0)
        
        if count > 0:
            snapshot[h3_index] = count
    )
    
    if len(snapshot) > 0:
        // Send to Redis publisher (non-blocking channel)
        publishChannel <- snapshot
```

**Why `sync.Map` + `atomic` instead of sharded mutexes?**
- `sync.Map` is optimized for read-heavy workloads (most GPS points hit existing cells)
- `atomic.AddUint64` compiles to a single CPU instruction (`LOCK XADD`)
- Zero lock contention = predictable latency under high concurrency

---

## 5. Batch Timing Strategy

```
┌───────────────────────────────────────────────────┐
│  GPS Points arrive continuously (~333 points/sec  │
│  for 1000 drivers at 3s intervals)                │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Lock-Free Aggregator (in-memory, always on)  │ │
│  └───────────────┬──────────────┬───────────────┘ │
│                  │              │                  │
│          ┌───────▼───────┐  ┌──▼──────────────┐  │
│          │ 1s Timer      │  │ 30s Timer       │  │
│          │ → Redis Flush │  │ → Postgres Flush│  │
│          │ → WS Broadcast│  │ (History store) │  │
│          └───────────────┘  └─────────────────┘  │
└───────────────────────────────────────────────────┘
```

| Timer       | Interval | Target      | Purpose                           |
| ----------- | -------- | ----------- | --------------------------------- |
| Redis flush | 1 second | Redis → WS  | Real-time dashboard updates       |
| PG flush    | 30 secs  | PostgreSQL  | Durable history for queries       |

Both timers use Go `time.Ticker` in separate goroutines with `context.Context` for graceful shutdown.
