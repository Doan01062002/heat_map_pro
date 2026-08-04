# ==============================================================================
# Development Environment Setup Script (PowerShell — Windows)
# ==============================================================================
# Run this once to verify prerequisites and install all dependencies.
# Usage: .\scripts\setup-dev.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Heatmap Dev Environment Setup (Windows)"
Write-Host "============================================" -ForegroundColor Cyan

# --- Check Prerequisites ---
Write-Host "`n[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Go
$goVersion = & go version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Go is not installed. Download from https://go.dev/dl/" -ForegroundColor Red
    exit 1
}
Write-Host "  Go:     $goVersion" -ForegroundColor Green

# Node.js
$nodeVersion = & node --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: Node.js is not installed. Download from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "  Node:   $nodeVersion" -ForegroundColor Green

# Docker
$dockerVersion = & docker --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Docker is not installed. Required for OSRM, Redis, PostgreSQL." -ForegroundColor Yellow
} else {
    Write-Host "  Docker: $dockerVersion" -ForegroundColor Green
}

# protoc (optional for codegen)
$protocVersion = & protoc --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: protoc not found. Install for Protobuf code generation." -ForegroundColor Yellow
} else {
    Write-Host "  protoc: $protocVersion" -ForegroundColor Green
}

# --- Copy .env ---
Write-Host "`n[2/6] Setting up environment..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  Created .env from .env.example" -ForegroundColor Green
} else {
    Write-Host "  .env already exists, skipping." -ForegroundColor Green
}

# --- Go Dependencies ---
Write-Host "`n[3/6] Installing Go dependencies..." -ForegroundColor Yellow
Push-Location backend
& go mod tidy
if ($LASTEXITCODE -ne 0) {
    Write-Host "  ERROR: go mod tidy failed" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  Go dependencies installed." -ForegroundColor Green

# --- Simulator Frontend ---
Write-Host "`n[4/6] Installing Simulator frontend dependencies..." -ForegroundColor Yellow
Push-Location frontend/simulator
& npm install
Pop-Location
Write-Host "  Simulator dependencies installed." -ForegroundColor Green

# --- Admin Frontend ---
Write-Host "`n[5/6] Installing Admin Dashboard frontend dependencies..." -ForegroundColor Yellow
Push-Location frontend/admin
& npm install
Pop-Location
Write-Host "  Admin dependencies installed." -ForegroundColor Green

# --- Generate Protobuf (if protoc is available) ---
Write-Host "`n[6/6] Generating Protobuf code..." -ForegroundColor Yellow
$protocCheck = & protoc --version 2>$null
if ($LASTEXITCODE -eq 0) {
    Push-Location backend
    & make proto
    Pop-Location
    Write-Host "  Protobuf code generated." -ForegroundColor Green
} else {
    Write-Host "  Skipped (protoc not installed)." -ForegroundColor Yellow
}

# --- Done ---
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Start infrastructure: docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up -d"
Write-Host "    2. Start Go backend:     cd backend && air"
Write-Host "    3. Start Simulator:      cd frontend/simulator && npm run dev"
Write-Host "    4. Start Admin:          cd frontend/admin && npm run dev"
Write-Host "============================================" -ForegroundColor Cyan
