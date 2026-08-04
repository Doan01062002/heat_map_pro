#!/usr/bin/env bash
# ==============================================================================
# Development Environment Setup Script (Linux/Mac)
# ==============================================================================
set -euo pipefail

echo "============================================"
echo "  Heatmap Dev Environment Setup (Unix)"
echo "============================================"

# Check prerequisites
echo ""
echo "[1/6] Checking prerequisites..."

command -v go >/dev/null 2>&1 && echo "  Go:     $(go version)" || { echo "  ERROR: Go not installed"; exit 1; }
command -v node >/dev/null 2>&1 && echo "  Node:   $(node --version)" || { echo "  ERROR: Node.js not installed"; exit 1; }
command -v docker >/dev/null 2>&1 && echo "  Docker: $(docker --version)" || echo "  WARNING: Docker not installed"
command -v protoc >/dev/null 2>&1 && echo "  protoc: $(protoc --version)" || echo "  WARNING: protoc not installed"

# Copy .env
echo ""
echo "[2/6] Setting up environment..."
[ ! -f .env ] && cp .env.example .env && echo "  Created .env" || echo "  .env exists"

# Go deps
echo ""
echo "[3/6] Installing Go dependencies..."
cd backend && go mod tidy && cd ..

# Simulator
echo ""
echo "[4/6] Installing Simulator frontend..."
cd frontend/simulator && npm install && cd ../..

# Admin
echo ""
echo "[5/6] Installing Admin Dashboard frontend..."
cd frontend/admin && npm install && cd ../..

# Protobuf
echo ""
echo "[6/6] Generating Protobuf code..."
if command -v protoc >/dev/null 2>&1; then
    cd backend && make proto && cd ..
else
    echo "  Skipped (protoc not installed)"
fi

echo ""
echo "============================================"
echo "  ✅ Setup complete!"
echo "============================================"
