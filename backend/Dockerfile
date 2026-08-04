# ==============================================================================
# Go Backend Dockerfile — Multi-stage build
# ==============================================================================
# Uses CGO_ENABLED=1 for h3-go (C bindings to Uber H3)
# ==============================================================================

# ---- Build Stage ----
FROM golang:1.22-alpine AS builder

# Install C compiler for CGO (required by h3-go)
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# Copy go.mod and go.sum first for dependency caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build with CGO enabled (for h3-go)
RUN CGO_ENABLED=1 GOOS=linux go build -o /server ./cmd/server

# ---- Runtime Stage ----
FROM alpine:3.19

# Install runtime dependencies for CGO
RUN apk add --no-cache ca-certificates libc6-compat wget

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy binary from builder
COPY --from=builder /server /app/server

# Switch to non-root user
USER 1001

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/app/server"]
