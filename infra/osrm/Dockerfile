# ==============================================================================
# OSRM Dockerfile — Pre-process map data and serve
# ==============================================================================
# This Dockerfile is OPTIONAL — only needed if you want to bake map data
# into the image. For development, use the osrm/osrm-backend image directly
# with a volume mount (see docker-compose.yml).
# ==============================================================================

FROM osrm/osrm-backend:latest AS processor

# Copy pre-downloaded map data
COPY data/ /data/

# Extract (skip if already extracted)
RUN if [ ! -f /data/vietnam-latest.osrm ]; then \
        osrm-extract -p /opt/car.lua /data/vietnam-latest.osm.pbf; \
    fi

# Partition (MLD algorithm)
RUN if [ ! -f /data/vietnam-latest.osrm.partition ]; then \
        osrm-partition /data/vietnam-latest.osrm; \
    fi

# Customize
RUN if [ ! -f /data/vietnam-latest.osrm.cell_metrics ]; then \
        osrm-customize /data/vietnam-latest.osrm; \
    fi

# ---- Production image ----
FROM osrm/osrm-backend:latest

COPY --from=processor /data/ /data/

EXPOSE 5000

CMD ["osrm-routed", "--algorithm", "mld", "--max-matching-size", "5000", "/data/vietnam-latest.osrm"]
