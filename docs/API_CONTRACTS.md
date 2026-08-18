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
  "active_drivers": 500
}
```

### 3.2 Driver Authentication

#### `POST /api/auth/register`
Đăng ký tài khoản tài xế mới.

**Request Body:**
```json
{
  "email": "driver1@example.com",
  "password": "secretpassword",
  "full_name": "Nguyễn Văn A",
  "phone": "0901234567",
  "license_plate": "51A-12345",
  "vehicle_type": "taxi"
}
```

**Response (201 Created):**
```json
{
  "token": "a1b2c3d4e5f6...",
  "driver": {
    "id": 1,
    "driver_id": "DRV-17F56574",
    "email": "driver1@example.com",
    "full_name": "Nguyễn Văn A",
    "phone": "0901234567",
    "license_plate": "51A-12345",
    "vehicle_type": "taxi",
    "status": "active"
  }
}
```

#### `POST /api/auth/login`
Đăng nhập tài xế.

**Request Body:**
```json
{
  "email": "driver1@example.com",
  "password": "secretpassword"
}
```

**Response (200 OK):**
```json
{
  "token": "a1b2c3d4e5f6...",
  "driver": {
    "id": 1,
    "driver_id": "DRV-17F56574",
    "email": "driver1@example.com",
    "full_name": "Nguyễn Văn A"
  }
}
```

#### `GET /api/auth/me`
Lấy hồ sơ tài xế hiện tại (truyền qua query `driver_id` hoặc header `Authorization: Bearer <token>`).

### 3.3 Chuyến Đi (Trips)

#### `POST /api/trips`
Lưu thông tin chuyến đi mới vào PostgreSQL và broadcast sự kiện `new_trip` tới admin clients.

**Request Body:**
```json
{
  "trip_id": "TRIP-ABC1234",
  "driver_id": "DRV-17F56574",
  "driver_name": "Nguyễn Văn A",
  "origin": { "lat": 10.8184, "lng": 106.6588, "label": "Sân bay Tân Sơn Nhất" },
  "destination": { "lat": 10.7725, "lng": 106.6980, "label": "Chợ Bến Thành" },
  "waypoints": [[106.6588, 10.8184], [106.6980, 10.7725]],
  "actual_route": [[106.6588, 10.8184], [106.71, 10.79], [106.6980, 10.7725]],
  "planned_route": [[106.6588, 10.8184], [106.6980, 10.7725]],
  "distance_km": 8.2,
  "duration_min": 25,
  "is_deviated": true
}
```

#### `GET /api/trips?driver_id=<id>&limit=<n>`
Lấy danh sách các chuyến đi đã lưu.

### 3.4 Historical Heatmap Query

```
GET /api/history?from=<unix_ms>&to=<unix_ms>&driver_id=<id>
```

**Response (200 OK):**
```json
{
  "cells": [
    {
      "h3_index": "882830828bfffff",
      "intensity": 150,
      "last_updated": 1722744000000,
      "unique_drivers": 3
    }
  ],
  "query": {
    "from": 1722740400000,
    "to": 1722744000000
  },
  "total_cells": 1
}
```

### 3.5 Raw Points & Trajectories

- `GET /api/points?from=<ms>&to=<ms>&limit=<n>&driver_id=<id>`: Lấy danh sách điểm GPS lệch thô để render scatter/point heatmap.
- `GET /api/trajectories?from=<ms>&to=<ms>&limit=<n>&driver_id=<id>`: Lấy danh sách lộ trình GPS dưới dạng GeoJSON LineString FeatureCollection.
- `GET /api/deviations?driver_id=<id>&from=<ms>&to=<ms>&limit=<n>`: Danh sách các sự kiện lệch lộ trình chi tiết.

### 3.6 Thống Kê & Phân Tích

- `GET /api/road-stats?lat=<lat>&lng=<lng>&radius=<m>`: Thống kê tổng hợp điểm lệch quanh điểm click bản đồ (dùng PostGIS `ST_DWithin`).
- `GET /api/hourly-stats`: Thống kê tần suất lệch lộ trình và tỷ lệ né tránh theo 24 khung giờ trong ngày (0–23h).
- `GET /api/actual-path?from=<ms>&to=<ms>&driver_id=<id>`: Dữ liệu ô H3 tổng hợp từ lộ trình thực tế tài xế chọn khi bẻ lái (lớp "Hex Tài Xế Đi").

### 3.7 AI Investigation

```
POST /api/ai/investigate
```

**Request Body:**
```json
{
  "h3_index": "882830828bfffff",
  "lat": 10.8184,
  "lng": 106.6588,
  "driver_id": "DRV-17F56574",
  "timestamp_ms": 1723264000000,
  "time_window_minutes": 30
}
```

**Response (200 OK):**
```json
{
  "h3_index": "882830828bfffff",
  "risk_level": "SAFE_FORCE_MAJEURE",
  "confidence": 0.95,
  "summary": "Tài xế né tránh hợp lý tại Nguyễn Văn Trỗi, Phú Nhuận do kẹt xe nghiêm trọng (tốc độ giảm 72%) kết hợp mưa lớn (12mm/h).",
  "evidence": {
    "weather": { "temperature": 27.5, "rain_mm": 12.0, "description": "Heavy Rain" },
    "news": [],
    "fleet_telemetry": {
      "total_events": 45,
      "unique_drivers": 6,
      "unique_trips": 8,
      "high_dev_trips": 6,
      "fleet_deviation_ratio": 0.75,
      "adjusted_deviation_ratio": 0.71,
      "margin_of_error": 0.18
    },
    "location_name": "Nguyễn Văn Trỗi, Phú Nhuận, TP.HCM"
  },
  "recommendation": "Tạm thời cập nhật OSRM bypass đoạn đường này. KHÔNG phạt tài xế."
}
```

---

## 4. Redis Pub/Sub Channel

```
Channel: heatmap:updates
```

**Message format:** JSON string của `HeatmapUpdate`.
- Go `publisher` đẩy delta mỗi 1 giây.
- Go `websocket` hub đăng ký kênh và phát broadcast tới các client Admin WebSocket `/ws/admin`.

---

## 5. Error Codes

| HTTP Status | Code                 | Description                                |
| ----------- | -------------------- | ------------------------------------------ |
| 200         | `OK`                 | Thành công                                 |
| 400         | `BAD_REQUEST`        | Tham số query hoặc request body không hợp lệ |
| 401         | `UNAUTHORIZED`       | Chưa đăng nhập hoặc sai thông tin xác thực |
| 404         | `NOT_FOUND`          | Không tìm thấy tài xế hoặc chuyến đi       |
| 408         | `OSRM_TIMEOUT`       | OSRM match API timeout quá 500ms           |
| 500         | `INTERNAL_ERROR`     | Lỗi máy chủ nội bộ                         |
| 503         | `SERVICE_UNAVAILABLE`| Dịch vụ Redis, PostgreSQL hoặc AI Agent mất kết nối |
