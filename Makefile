# ==============================================================================
# Root Makefile — Real-Time Driver Deviation Heatmap
# ==============================================================================
# Usage:
#   make up          — Start all services via Docker Compose
#   make down        — Stop all services
#   make dev         — Start dev environment (backend + frontends, no Docker)
#   make proto       — Generate Protobuf code for Go and JS
#   make test-all    — Run all backend tests
#   make lint        — Lint Go backend
#   make clean       — Remove all build artifacts
# ==============================================================================

.PHONY: up down dev proto test-all lint clean logs osrm-prepare

# ---- Docker Compose ----

up:
	docker compose -f infra/docker-compose.yml --env-file .env up -d --build
	@echo "✅ All services started. Admin: http://localhost/admin  Simulator: http://localhost/simulator"

down:
	docker compose -f infra/docker-compose.yml down

logs:
	docker compose -f infra/docker-compose.yml logs -f

# ---- Development (no Docker for Go/Frontend) ----

dev:
	@echo "Starting development environment..."
	@echo "  1. Make sure Redis and PostgreSQL are running (docker compose up redis postgres osrm)"
	@echo "  2. Starting Go backend with hot-reload..."
	cd backend && air &
	@echo "  3. Starting Simulator frontend..."
	cd frontend/simulator && npm run dev &
	@echo "  4. Starting Admin frontend..."
	cd frontend/admin && npm run dev &
	@echo "✅ Dev environment running."

# ---- Protobuf ----

proto:
	@echo "Generating Protobuf Go code..."
	protoc \
		--proto_path=proto \
		--go_out=backend/gen \
		--go_opt=paths=source_relative \
		proto/heatmap/v1/messages.proto
	@echo "✅ Go protobuf code generated in backend/gen/"

# ---- Testing ----

test-all:
	cd backend && go test ./... -v -race -count=1

# ---- Linting ----

lint:
	cd backend && golangci-lint run ./...

# ---- OSRM Data Preparation ----

osrm-prepare:
	bash scripts/download-map.sh
	@echo "✅ OSRM map data prepared."

# ---- Cleanup ----

clean:
	rm -rf backend/bin/ backend/tmp/
	rm -rf frontend/simulator/dist/ frontend/simulator/node_modules/
	rm -rf frontend/admin/dist/ frontend/admin/node_modules/
	@echo "✅ Cleaned all build artifacts."
