#!/usr/bin/env bash
# ==============================================================================
# OSRM Map Data Preparation Script
# ==============================================================================
# Downloads Vietnam OSM data from Geofabrik and runs OSRM pre-processing.
# Run this ONCE before starting the system.
#
# Usage: bash scripts/download-map.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_ROOT/infra/osrm/data"

MAP_URL="${OSRM_MAP_URL:-https://download.geofabrik.de/asia/vietnam-latest.osm.pbf}"
MAP_FILE="${OSRM_MAP_FILE:-vietnam-latest.osm.pbf}"
MAP_BASE="${MAP_FILE%.osm.pbf}"

echo "============================================"
echo "  OSRM Map Data Preparation"
echo "============================================"
echo "  Data directory: $DATA_DIR"
echo "  Map file:       $MAP_FILE"
echo "  Map URL:        $MAP_URL"
echo "============================================"

# Create data directory
mkdir -p "$DATA_DIR"

# Step 1: Download map data
if [ -f "$DATA_DIR/$MAP_FILE" ]; then
    echo "[1/4] ✅ Map file already exists, skipping download."
else
    echo "[1/4] ⬇️  Downloading $MAP_FILE..."
    curl -L -o "$DATA_DIR/$MAP_FILE" "$MAP_URL"
    echo "[1/4] ✅ Download complete."
fi

# Step 2: Extract
if [ -f "$DATA_DIR/$MAP_BASE.osrm" ]; then
    echo "[2/4] ✅ Already extracted, skipping."
else
    echo "[2/4] 🔧 Extracting road network (this takes ~10 minutes)..."
    docker run --rm -t \
        -v "$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-extract -p /opt/car.lua "/data/$MAP_FILE"
    echo "[2/4] ✅ Extraction complete."
fi

# Step 3: Partition (MLD algorithm)
if [ -f "$DATA_DIR/$MAP_BASE.osrm.partition" ]; then
    echo "[3/4] ✅ Already partitioned, skipping."
else
    echo "[3/4] 🔧 Partitioning (MLD algorithm)..."
    docker run --rm -t \
        -v "$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-partition "/data/$MAP_BASE.osrm"
    echo "[3/4] ✅ Partitioning complete."
fi

# Step 4: Customize
if [ -f "$DATA_DIR/$MAP_BASE.osrm.cell_metrics" ]; then
    echo "[4/4] ✅ Already customized, skipping."
else
    echo "[4/4] 🔧 Customizing..."
    docker run --rm -t \
        -v "$DATA_DIR:/data" \
        osrm/osrm-backend \
        osrm-customize "/data/$MAP_BASE.osrm"
    echo "[4/4] ✅ Customization complete."
fi

echo ""
echo "============================================"
echo "  ✅ OSRM map data is ready!"
echo "  Files are in: $DATA_DIR/"
echo "  You can now run: make up"
echo "============================================"
