# Deployment Guide — Real-Time Driver Deviation Heatmap

> Step-by-step guide for deploying to a Google Cloud VPS (4GB RAM, 2 vCPU, Ubuntu 22.04).

---

## 1. VPS Setup

### 1.1 Create the VM

```bash
# Google Cloud CLI
gcloud compute instances create heatmap-demo \
    --machine-type=e2-medium \
    --zone=asia-southeast1-a \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --tags=http-server,https-server

# Allow HTTP traffic
gcloud compute firewall-rules create allow-http \
    --allow tcp:80 \
    --target-tags http-server
```

### 1.2 Install Docker

```bash
# SSH into the VM
gcloud compute ssh heatmap-demo --zone=asia-southeast1-a

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

### 1.3 Clone the Repository

```bash
cd /opt
sudo git clone <repo-url> heatmap
sudo chown -R $USER:$USER /opt/heatmap
cd /opt/heatmap
```

---

## 2. OSRM Map Data Preparation

This step downloads and pre-processes the Vietnam OSM map (~300MB download, ~20 min processing).

```bash
# Run the preparation script
bash scripts/download-map.sh

# This creates:
# infra/osrm/data/vietnam-latest.osm.pbf     (original download)
# infra/osrm/data/vietnam-latest.osrm         (extracted)
# infra/osrm/data/vietnam-latest.osrm.*       (partitioned + customized)
```

**Alternative: Manual preparation**

```bash
mkdir -p infra/osrm/data
cd infra/osrm/data

# Download map data
wget https://download.geofabrik.de/asia/vietnam-latest.osm.pbf

# Extract
docker run -t -v $(pwd):/data osrm/osrm-backend \
    osrm-extract -p /opt/car.lua /data/vietnam-latest.osm.pbf

# Partition (MLD algorithm)
docker run -t -v $(pwd):/data osrm/osrm-backend \
    osrm-partition /data/vietnam-latest.osrm

# Customize
docker run -t -v $(pwd):/data osrm/osrm-backend \
    osrm-customize /data/vietnam-latest.osrm
```

---

## 3. Configure Environment

```bash
cd /opt/heatmap
cp .env.example .env

# Edit production values
nano .env
```

**Key changes for production:**
```bash
APP_ENV=production
LOG_LEVEL=info
POSTGRES_PASSWORD=<strong-random-password>
```

---

## 4. Deploy with Docker Compose

```bash
# Build and start all services
make up

# Or directly:
docker compose -f infra/docker-compose.yml --env-file .env up -d --build

# Check all services are healthy
docker compose -f infra/docker-compose.yml ps
```

**Expected output:**
```
NAME         SERVICE     STATUS          PORTS
osrm         osrm        Up (healthy)    5000/tcp
postgres     postgres    Up (healthy)    5432/tcp
redis        redis       Up (healthy)    6379/tcp
backend      backend     Up (healthy)    8080/tcp
nginx        nginx       Up (healthy)    0.0.0.0:80->80/tcp
```

---

## 5. Verify Deployment

### Health Check
```bash
curl http://localhost/api/health
```

**Expected:**
```json
{
  "status": "healthy",
  "redis_connected": true,
  "postgres_connected": true,
  "osrm_connected": true
}
```

### Access the Apps
- **Admin Dashboard:** `http://<VM_EXTERNAL_IP>/admin`
- **Driver Simulator:** `http://<VM_EXTERNAL_IP>/simulator`

---

## 6. Monitoring

### Docker Logs
```bash
# All services
make logs

# Specific service
docker compose -f infra/docker-compose.yml logs -f backend
docker compose -f infra/docker-compose.yml logs -f osrm
```

### Resource Monitoring
```bash
# Real-time resource usage
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
```

### PostgreSQL Connection
```bash
docker compose -f infra/docker-compose.yml exec postgres \
    psql -U heatmap -d heatmap_db -c "SELECT count(*) FROM deviation_events;"
```

### Redis Status
```bash
docker compose -f infra/docker-compose.yml exec redis \
    redis-cli INFO memory | grep used_memory_human
```

---

## 7. Troubleshooting

| Symptom                          | Cause                        | Fix                                         |
| -------------------------------- | ---------------------------- | ------------------------------------------- |
| OSRM returns 400 errors         | Map data not pre-processed   | Re-run `bash scripts/download-map.sh`       |
| Backend OOM killed               | Too many connections         | Reduce driver count, check resource limits  |
| Redis connection refused         | Redis not started            | `docker compose up -d redis`                |
| PostgreSQL "relation not found"  | Schema not initialized       | Check `init.sql` ran on first startup       |
| WebSocket connection drops       | Nginx timeout                | Check `nginx.conf` proxy timeouts           |
| High CPU on OSRM                 | Too many match API calls     | Increase bounding box buffer (reduce calls) |

---

## 8. Backup & Recovery

### PostgreSQL Backup
```bash
# Create backup
docker compose -f infra/docker-compose.yml exec postgres \
    pg_dump -U heatmap heatmap_db > backup_$(date +%Y%m%d).sql

# Restore backup
docker compose -f infra/docker-compose.yml exec -T postgres \
    psql -U heatmap heatmap_db < backup_20240804.sql
```

### Full Reset
```bash
# Stop and remove all containers, volumes, and networks
docker compose -f infra/docker-compose.yml down -v

# Restart fresh
make up
```
