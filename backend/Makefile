# ==============================================================================
# Backend Makefile
# ==============================================================================

.PHONY: build test lint proto dev clean

# ---- Build ----
build:
	CGO_ENABLED=1 go build -o bin/server ./cmd/server

# ---- Test ----
test:
	go test ./... -v -race -count=1 -timeout=60s

# ---- Lint ----
lint:
	golangci-lint run ./...

# ---- Protobuf Code Generation ----
proto:
	@mkdir -p gen/heatmap/v1
	protoc \
		--proto_path=../proto \
		--go_out=gen \
		--go_opt=paths=source_relative \
		../proto/heatmap/v1/messages.proto
	@echo "✅ Protobuf Go code generated in gen/heatmap/v1/"

# ---- Development (hot-reload with air) ----
dev:
	air

# ---- Clean ----
clean:
	rm -rf bin/ tmp/
