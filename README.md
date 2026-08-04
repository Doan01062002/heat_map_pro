# 🗺️ Real-Time Driver Deviation Heatmap

> **Version 1.0.0** — Detect and visualize driver route deviations in real-time using GPS data, map-matching, and spatial aggregation.

## What This Does

In ride-hailing platforms (Grab, Uber, Xanh SM), drivers sometimes deviate from the planned route — causing higher costs, longer trips, and passenger anxiety. This system:

1. **Simulates** hundreds of concurrent drivers sending GPS coordinates
2. **Detects** deviations by comparing GPS traces against planned routes (using OSRM map-matching)
3. **Aggregates** deviation hotspots into H3 hexagonal cells
4. **Visualizes** a real-time 3D heatmap on an admin dashboard

```
┌──────────────┐    Protobuf/WS     ┌──────────────────┐     Redis Pub/Sub     ┌──────────────────┐
│  Simulator   │ ──── (3s cycle) ──►│   Go Backend     │ ──── (1s batch) ────►│  Admin Dashboard │
│  (N drivers) │                    │  - BBox Filter   │                      │  - Deck.gl       │
│  Web Workers │                    │  - OSRM Match    │                      │  - H3 Hexagons   │
│              │                    │  - H3 Index      │                      │  - 3D Heatmap    │
└──────────────┘                    │  - Lock-free Agg │                      └──────────────────┘
                                    └───────┬──────────┘
                                            │ (30s batch)
                                    ┌───────▼──────────┐
                                    │  PostgreSQL      │
                                    │  + PostGIS       │
                                    │  (History Store) │
                                    └──────────────────┘
```

## Tech Stack

| Layer              | Technology                          | Why                                           |
| ------------------ | ----------------------------------- | --------------------------------------------- |
| Backend            | **Go 1.22+**                        | Goroutines, ultra-low RAM (~40MB), fast I/O    |
| Map Matching       | **OSRM C++** (Docker)               | Industry-standard HMM algorithm               |
| Spatial Indexing   | **Uber H3** (h3-go)                 | Hexagonal grid, O(1) lat/lng → cell            |
| Protocol           | **Protobuf + WebSocket**            | 80% smaller than JSON, binary framing          |
| Cache / Pub-Sub    | **Redis**                           | In-memory speed, native Pub/Sub                |
| Database           | **PostgreSQL + PostGIS**            | Spatial queries, time-series history           |
| Simulator          | **React + Vite + Web Workers**      | Multi-threaded GPS generation                  |
| Admin Dashboard    | **React + Deck.gl + MapLibre**      | WebGL 3D hexagon rendering                    |
| Orchestration      | **Docker Compose**                  | Single-command deployment                      |

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2
- [Go 1.22+](https://go.dev/dl/) (for local development)
- [Node.js 20+](https://nodejs.org/) (for frontend development)
- [protoc](https://grpc.io/docs/protoc-installation/) (for Protobuf code generation)

### 1. Clone & Configure

```bash
git clone <repo-url> heat_map_pro
cd heat_map_pro
cp .env.example .env
```

### 2. Download Map Data & Start Services

```bash
# Download Vietnam OSM data (~300MB) and prepare OSRM
make osrm-prepare

# Start all services (builds Docker images on first run)
make up
```

### 3. Access the Apps

| App              | URL                          |
| ---------------- | ---------------------------- |
| Admin Dashboard  | http://localhost/admin        |
| Driver Simulator | http://localhost/simulator    |
| Go Backend API   | http://localhost/api/health   |

### Local Development (without Docker for Go/Frontend)

```bash
# Start only infrastructure services
docker compose -f infra/docker-compose.yml up -d redis postgres osrm

# Install dependencies & start dev servers
cd backend && go mod tidy && air
cd frontend/simulator && npm install && npm run dev
cd frontend/admin && npm install && npm run dev
```

## Project Structure

```
heat_map_pro/
├── .agents/           # AI agent coding rules
├── docs/              # Architecture, API contracts, algorithms, deployment
├── proto/             # Protobuf schema (single source of truth)
├── backend/           # Go backend (cmd/ + internal/ layout)
├── frontend/
│   ├── simulator/     # Driver Simulator WebApp (Vite + React)
│   └── admin/         # Admin Heatmap Dashboard (Vite + React + Deck.gl)
├── infra/             # Docker Compose, OSRM, PostgreSQL, Nginx configs
├── scripts/           # Setup and utility scripts
└── Makefile           # Root orchestration commands
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — System design, component boundaries, resource allocation
- [API Contracts](docs/API_CONTRACTS.md) — WebSocket, Protobuf, REST API specifications
- [Algorithms](docs/ALGORITHMS.md) — Bounding box filter, map-matching, H3 indexing, lock-free aggregation
- [Data Flow](docs/DATA_FLOW.md) — End-to-end data pipeline with sequence diagrams
- [Deployment](docs/DEPLOYMENT.md) — Google Cloud VPS setup and production deployment

## Key Commands

```bash
make up             # Start all services
make down           # Stop all services
make dev            # Start local dev environment
make proto          # Generate Protobuf code
make test-all       # Run all Go tests
make lint           # Lint Go code
make logs           # Follow Docker logs
make clean          # Remove build artifacts
```

## Resource Budget (4GB VPS)

| Service          | RAM Limit | Notes                       |
| ---------------- | --------- | --------------------------- |
| Ubuntu OS        | ~500 MB   | Base system                 |
| PostgreSQL       | 800 MB    | PostGIS + query cache       |
| OSRM Engine      | 400 MB    | Vietnam map in memory       |
| Redis            | 200 MB    | Heatmap state + Pub/Sub     |
| Go Backend       | 40 MB     | Goroutines + in-memory agg  |
| Static Frontends | 20 MB     | Nginx serving built assets  |
| **Buffer**       | **>2 GB** | Burst headroom              |

## License

Private — Internal use only.
