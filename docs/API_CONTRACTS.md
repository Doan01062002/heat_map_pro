# API Contracts — Real-Time Driver Deviation Heatmap

> Single source of truth for all inter-service communication protocols.
> Protobuf schema: `proto/heatmap/v1/messages.proto`

---

## 1. Protobuf Messages

All binary messages use Protocol Buffers v3. The `.proto` file is the canonical reference.

### GPSPoint

A single GPS reading from a simulated driver.

| Field       | Type     | Number | Description                              |
| ----------- | -------- | ------ | ---------------------------------------- |
| `driver_id` | `string` | 1      | Unique driver identifier (e.g., `d-001`) |
| `trip_id`   | `string` | 2      | Current trip identifier                  |
| `latitude`  | `double` | 3      | WGS84 latitude (-90 to 90)               |
| `longitude` | `double` | 4      | WGS84 longitude (-180 to 180)            |
| `timestamp` | `int64`  | 5      | Unix timestamp in milliseconds           |
| `heading`   | `float`  | 6      | Bearing in degrees (0-360)               |
| `speed`     | `float`  | 7      | Speed in km/h                            |

### GPSBatch

A batch of GPS points sent from the simulator every 3 seconds.

| Field    | Type              | Number | Description                 |
| -------- | ----------------- | ------ | --------------------------- |
| `points` | `repeated GPSPoint` | 1    | Array of GPS readings       |

### HeatmapCell

A single hexagonal cell with deviation intensity.

| Field          | Type     | Number | Description                                  |
| -------------- | -------- | ------ | -------------------------------------------- |
| `h3_index`     | `string` | 1      | H3 cell index (Resolution 8, e.g., `882830828bfffff`) |
| `intensity`    | `uint32` | 2      | Deviation count (higher = more deviations)   |
| `last_updated` | `int64`  | 3      | Unix timestamp (ms) of last deviation in cell |

### HeatmapUpdate

Pushed from backend to admin dashboard every 1 second.

| Field              | Type                   | Number | Description                  |
| ------------------ | ---------------------- | ------ | ---------------------------- |
| `cells`            | `repeated HeatmapCell` | 1      | Updated cells only (delta)   |
| `server_timestamp` | `int64`                | 2      | Server time (ms)             |
| `total_drivers`    | `uint32`               | 3      | Currently active drivers     |
| `total_deviations` | `uint32`               | 4      | Total deviations this window |

### TripRoute

The planned route for a trip (sent once at trip start).

| Field       | Type                | Number | Description                        |
| ----------- | ------------------- | ------ | ---------------------------------- |
| `trip_id`   | `string`            | 1      | Trip identifier                    |
| `waypoints` | `repeated GPSPoint` | 2      | Ordered waypoints of planned route |

---

## 2. WebSocket Endpoints

### 2.1 Driver GPS Ingestion

```
Endpoint:  ws://<host>:8080/ws/driver
Direction: Simulator → Backend
Protocol:  Binary frames (Protobuf-encoded GPSBatch)
Auth:      None (demo)
```

**Connection flow:**
1. Simulator opens WebSocket to `/ws/driver`
2. Every 3 seconds, simulator sends a binary frame containing `GPSBatch`
3. Backend decodes, runs filter pipeline, updates aggregator
4. No response is sent back (fire-and-forget)

**Error handling:**
- If connection drops, simulator reconnects after 2s with exponential backoff (max 30s)
- Backend logs disconnections but does not persist them

### 2.2 Trip Route Registration

```
Endpoint:  POST /api/trips
Direction: Simulator → Backend
Protocol:  JSON (REST)
```

**Request body:**
```json
{
  "trip_id": "trip-abc-123",
  "driver_id": "d-001",
  "waypoints": [
    { "latitude": 10.7769, "longitude": 106.7009 },
    { "latitude": 10.7800, "longitude": 106.7050 },
    { "latitude": 10.7850, "longitude": 106.7100 }
  ]
}
```

**Response:**
```json
{
  "trip_id": "trip-abc-123",
  "bounding_box": {
    "min_lat": 10.7764,
    "min_lng": 106.7004,
    "max_lat": 10.7855,
    "max_lng": 106.7105
  },
  "status": "registered"
}
```

### 2.3 Admin Heatmap Stream

```
Endpoint:  ws://<host>:8080/ws/admin
Direction: Backend → Admin Dashboard
Protocol:  JSON frames (HeatmapUpdate as JSON)
```

> **Note:** Admin receives JSON (not Protobuf) for easier debugging and browser dev tools inspection.

**Message format (JSON):**
```json
{
  "cells": [
    { "h3_index": "882830828bfffff", "intensity": 15, "last_updated": 1722744000000 },
    { "h3_index": "8828308283fffff", "intensity": 3, "last_updated": 1722744000500 }
  ],
  "server_timestamp": 1722744001000,
  "total_drivers": 500,
  "total_deviations": 42
}
```

**Connection flow:**
1. Admin dashboard opens WebSocket to `/ws/admin`
2. Backend subscribes to Redis `heatmap:updates` channel
3. Every 1 second, backend pushes `HeatmapUpdate` JSON to all connected admin clients
4. Admin dashboard updates Deck.gl layer with new cell data

---

## 3. REST API Endpoints

### 3.1 Health Check

```
GET /api/health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "uptime_seconds": 3600,
  "active_drivers": 500,
  "redis_connected": true,
  "postgres_connected": true,
  "osrm_connected": true
}
```

### 3.2 Historical Heatmap Query

```
GET /api/history?from=<unix_ms>&to=<unix_ms>&resolution=<h3_res>
```

**Parameters:**

| Param        | Type   | Required | Default | Description                 |
| ------------ | ------ | -------- | ------- | --------------------------- |
| `from`       | int64  | Yes      | —       | Start timestamp (unix ms)   |
| `to`         | int64  | Yes      | —       | End timestamp (unix ms)     |
| `resolution` | int    | No       | 8       | H3 resolution (7-9)         |

**Response (200 OK):**
```json
{
  "cells": [
    { "h3_index": "882830828bfffff", "intensity": 150, "last_updated": 1722744000000 },
    { "h3_index": "8828308283fffff", "intensity": 30, "last_updated": 1722744000500 }
  ],
  "query": {
    "from": 1722740400000,
    "to": 1722744000000,
    "resolution": 8
  },
  "total_cells": 2
}
```

### 3.3 Driver Deviation Events (Detail)

```
GET /api/deviations?driver_id=<id>&from=<unix_ms>&to=<unix_ms>&limit=<n>
```

**Response (200 OK):**
```json
{
  "events": [
    {
      "id": 1,
      "driver_id": "d-001",
      "trip_id": "trip-abc-123",
      "latitude": 10.7821,
      "longitude": 106.7089,
      "h3_index": "882830828bfffff",
      "deviation_meters": 120.5,
      "timestamp": 1722743500000
    }
  ],
  "total": 1
}
```

---

## 4. Redis Pub/Sub Channel

```
Channel: heatmap:updates
```

**Message format:** JSON string of `HeatmapUpdate` (same as WebSocket admin format).

The Go `publisher` package publishes to this channel every 1 second.
The Go `websocket` hub subscribes to this channel and broadcasts to admin WebSocket clients.

---

## 5. Error Codes

| HTTP Status | Code                 | Description                                |
| ----------- | -------------------- | ------------------------------------------ |
| 200         | `OK`                 | Success                                    |
| 400         | `BAD_REQUEST`        | Invalid query parameters                   |
| 404         | `NOT_FOUND`          | Trip or driver not found                   |
| 408         | `OSRM_TIMEOUT`       | OSRM match API timed out (>500ms)          |
| 500         | `INTERNAL_ERROR`     | Server error                               |
| 503         | `SERVICE_UNAVAILABLE`| Redis or PostgreSQL connection lost         |
