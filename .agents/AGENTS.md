# AI Agent Rules — heat_map_pro

> These rules are loaded automatically by AI coding assistants.
> They define coding conventions, architecture boundaries, and forbidden patterns
> so that ANY model (including weaker ones) produces consistent, correct code.

## Project Context

This is a **Real-Time Driver Deviation Heatmap** system with:
- A **Go backend** (WebSocket ingestion, OSRM integration, H3 spatial indexing, Redis pub/sub)
- A **Driver Simulator** frontend (React + Vite, Web Workers, Protobuf)
- An **Admin Dashboard** frontend (React + Vite, Deck.gl H3HexagonLayer, MapLibre)
- Infrastructure: OSRM (C++ Docker), PostgreSQL + PostGIS, Redis

## Critical Rules

### 1. Architecture Boundaries (NEVER VIOLATE)

```
backend/cmd/server/main.go  → ONLY wiring & startup. No business logic.
backend/internal/config/    → Config structs & env loading ONLY.
backend/internal/ingestion/ → WebSocket handler. Receives GPS data, calls filter pipeline.
backend/internal/filter/    → Bounding box check + OSRM client. Pure filtering logic.
backend/internal/spatial/   → H3 indexing ONLY. Converts (lat, lng) → H3 cell string.
backend/internal/aggregator/→ Lock-free counter map. sync.Map + atomic ops. NO Redis calls.
backend/internal/publisher/ → Redis publish + batch flush. Reads FROM aggregator, writes TO Redis.
backend/internal/persistence/→ PostgreSQL writes ONLY. Batch insert deviation events.
backend/internal/websocket/ → Admin WebSocket hub. Subscribes FROM Redis, pushes TO browser clients.
```

**Import rules:**
- `ingestion` may import `filter`, `spatial`, `aggregator` — NOT `publisher`, `persistence`, `websocket`
- `publisher` may import `aggregator` (to read counters) and `config` — NOT `ingestion` or `filter`
- `persistence` may import `config` — NOT any other internal package
- `websocket` may import `config` — NOT any other internal package
- `cmd/server` may import ALL internal packages (it does dependency wiring)

### 2. Go Coding Standards

- **Go 1.22+** minimum. Use `log/slog` for structured logging (NOT `log.Println`).
- **Error handling:** Always wrap errors with `fmt.Errorf("functionName: %w", err)`. Never ignore errors silently.
- **Context:** Every function that does I/O MUST accept `context.Context` as the first parameter.
- **Naming:** Use domain-specific names. NO packages named `utils`, `helpers`, `common`.
- **Concurrency:** Use `sync.Map` + `atomic` operations in the aggregator. NO `sync.Mutex` in the hot path.
- **Tests:** Every `.go` file MUST have a corresponding `_test.go`. Use table-driven tests.
- **Interface-first:** Define interfaces in the CONSUMER package, not the provider. For example, `ingestion/handler.go` defines the `Filter` interface, not `filter/bounding_box.go`.

### 3. Protobuf Rules

- The **single source of truth** for all message schemas is `proto/heatmap/v1/messages.proto`.
- NEVER manually create Go structs that duplicate Protobuf messages.
- After changing `.proto` files, run `make proto` to regenerate Go code.
- Generated Go code lives in `backend/gen/heatmap/v1/` — NEVER edit generated files.
- Frontend uses `protobufjs` to decode the same `.proto` file — keep schemas in sync.

### 4. Frontend Conventions

- **Framework:** React 18+ with functional components and hooks ONLY. No class components.
- **Bundler:** Vite. Config in `vite.config.js`.
- **Styling:** Vanilla CSS with CSS custom properties (design tokens). NO Tailwind, NO CSS-in-JS.
- **State:** React `useState`/`useReducer` + context. NO Redux, NO Zustand (project is small enough).
- **WebSocket:** Always use the shared `useWebSocket` hook. Never create raw WebSocket connections in components.
- **Map:** MapLibre GL JS (free, no API key). Deck.gl for the H3 hexagon layer.
- **File naming:** `PascalCase.jsx` for components, `camelCase.js` for hooks/utils.

### 5. Docker & Infrastructure

- All services defined in `infra/docker-compose.yml`.
- Resource limits MUST be set for every service (we run on a 4GB VPS).
- OSRM map data (`*.osm.pbf`) is NEVER committed to Git.
- Database schema changes go in `infra/postgres/init.sql` for initial setup, or numbered migration files for subsequent changes.

### 6. Forbidden Patterns (AI Models: NEVER DO THESE)

- ❌ Do NOT use `log.Fatal` or `os.Exit` anywhere except `cmd/server/main.go`.
- ❌ Do NOT use global variables for state. Pass dependencies via constructor injection.
- ❌ Do NOT use `sync.Mutex` in the aggregator hot path — use `sync.Map` + `atomic.AddUint64`.
- ❌ Do NOT send every GPS point directly to Redis — batch them (1s interval).
- ❌ Do NOT send every GPS point to OSRM — pre-filter with bounding box first.
- ❌ Do NOT use `any` or `interface{}` when a concrete type or generic is possible.
- ❌ Do NOT create files named `utils.go`, `helpers.go`, or `common.go`.
- ❌ Do NOT import from one frontend app into the other (simulator ↔ admin are independent).
- ❌ Do NOT hardcode URLs, ports, or credentials. Always use environment variables via config.
- ❌ Do NOT use `setTimeout`/`setInterval` in React components for WebSocket reconnection — use the shared hook.

### 7. Environment Variables

- All env vars are defined in `.env.example` with descriptions.
- Go backend reads them via `internal/config/config.go`.
- Frontend reads `VITE_*` prefixed vars at build time via `import.meta.env`.

### 8. Testing Requirements

- Go: `go test ./... -race` must pass before any PR.
- Frontend: Components must have basic render tests (React Testing Library).
- Integration: Test OSRM client with a mock HTTP server, NOT a live OSRM instance.

### 9. Git Conventions

- Branch naming: `feature/<module>-<description>`, `fix/<module>-<description>`
- Commit messages: `feat(module): description`, `fix(module): description`, `docs: description`
- Examples:
  - `feat(aggregator): implement lock-free H3 counter map`
  - `fix(osrm-client): handle timeout on match API`
  - `docs: add deployment guide for GCP VPS`

### 10. Performance Constraints

- Go backend MUST use < 50MB RAM under normal load (500 drivers).
- WebSocket message size from simulator → backend MUST be < 1KB per batch.
- Heatmap update from backend → admin MUST be < 10KB per update.
- OSRM match API calls MUST timeout after 500ms.
- Redis flush interval: 1 second. PostgreSQL flush interval: 30 seconds.
