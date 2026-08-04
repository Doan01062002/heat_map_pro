/**
 * driverWorker.js — Web Worker for simulating GPS traces.
 *
 * This worker runs in a separate thread, generating GPS coordinates
 * for a batch of virtual drivers. It posts JSON-encoded GPSBatch
 * messages back to the main thread every 3 seconds.
 *
 * Messages IN (from main thread):
 *   { type: 'start', driverCount: number, deviationPercent: number }
 *   { type: 'stop' }
 *
 * Messages OUT (to main thread):
 *   { type: 'batch', data: string }  // JSON GPSBatch ready to send via WS
 *   { type: 'stats', pointsGenerated: number, drivers: Array }
 */

// Pre-defined routes in HCMC (real coordinates)
const ROUTES = [
  // Route 1: District 1 — Nguyen Hue → Ben Thanh
  [
    { lat: 10.7743, lng: 106.7029 }, { lat: 10.7738, lng: 106.7035 },
    { lat: 10.7731, lng: 106.7042 }, { lat: 10.7724, lng: 106.7048 },
    { lat: 10.7718, lng: 106.7055 }, { lat: 10.7711, lng: 106.7061 },
    { lat: 10.7704, lng: 106.7068 }, { lat: 10.7698, lng: 106.7075 },
    { lat: 10.7691, lng: 106.7082 }, { lat: 10.7685, lng: 106.7004 },
  ],
  // Route 2: District 7 — Phu My Hung
  [
    { lat: 10.7286, lng: 106.7174 }, { lat: 10.7293, lng: 106.7182 },
    { lat: 10.7300, lng: 106.7191 }, { lat: 10.7308, lng: 106.7199 },
    { lat: 10.7315, lng: 106.7208 }, { lat: 10.7323, lng: 106.7216 },
    { lat: 10.7330, lng: 106.7225 }, { lat: 10.7338, lng: 106.7233 },
    { lat: 10.7345, lng: 106.7242 }, { lat: 10.7353, lng: 106.7250 },
  ],
  // Route 3: District 3 — Vo Van Tan
  [
    { lat: 10.7800, lng: 106.6900 }, { lat: 10.7793, lng: 106.6912 },
    { lat: 10.7786, lng: 106.6924 }, { lat: 10.7779, lng: 106.6936 },
    { lat: 10.7772, lng: 106.6948 }, { lat: 10.7765, lng: 106.6960 },
    { lat: 10.7758, lng: 106.6972 }, { lat: 10.7751, lng: 106.6984 },
    { lat: 10.7744, lng: 106.6996 }, { lat: 10.7737, lng: 106.7008 },
  ],
  // Route 4: Binh Thanh — Xo Viet Nghe Tinh
  [
    { lat: 10.8050, lng: 106.7100 }, { lat: 10.8040, lng: 106.7110 },
    { lat: 10.8030, lng: 106.7120 }, { lat: 10.8020, lng: 106.7130 },
    { lat: 10.8010, lng: 106.7140 }, { lat: 10.8000, lng: 106.7150 },
    { lat: 10.7990, lng: 106.7160 }, { lat: 10.7980, lng: 106.7170 },
    { lat: 10.7970, lng: 106.7180 }, { lat: 10.7960, lng: 106.7190 },
  ],
  // Route 5: Thu Duc — Vo Van Ngan
  [
    { lat: 10.8500, lng: 106.7600 }, { lat: 10.8490, lng: 106.7615 },
    { lat: 10.8480, lng: 106.7630 }, { lat: 10.8470, lng: 106.7645 },
    { lat: 10.8460, lng: 106.7660 }, { lat: 10.8450, lng: 106.7675 },
    { lat: 10.8440, lng: 106.7690 }, { lat: 10.8430, lng: 106.7705 },
    { lat: 10.8420, lng: 106.7720 }, { lat: 10.8410, lng: 106.7735 },
  ],
];

let intervalId = null;
let drivers = [];
let batchCount = 0;

self.onmessage = function (event) {
  const { type } = event.data;

  switch (type) {
    case 'start':
      startSimulation(event.data);
      break;
    case 'stop':
      stopSimulation();
      break;
    default:
      console.warn('[Worker] Unknown message type:', type);
  }
};

function startSimulation({ driverCount, deviationPercent }) {
  if (intervalId) {
    clearInterval(intervalId);
  }

  batchCount = 0;

  // Initialize driver state
  drivers = [];
  for (let i = 0; i < driverCount; i++) {
    const id = `d-${String(i + 1).padStart(3, '0')}`;
    const route = ROUTES[i % ROUTES.length];
    drivers.push({
      id,
      tripId: `trip-${id}-${Date.now()}`,
      route,
      routeIndex: Math.floor(Math.random() * route.length), // Random start position
      direction: 1, // 1 = forward, -1 = backward (ping-pong along route)
      isDeviating: Math.random() * 100 < deviationPercent,
      deviationOffset: {
        lat: (Math.random() - 0.5) * 0.008, // 400-800m random offset
        lng: (Math.random() - 0.5) * 0.008,
      },
    });
  }

  // Generate GPS batches every 3 seconds
  intervalId = setInterval(() => {
    const points = [];

    for (const driver of drivers) {
      const point = generateNextPoint(driver);
      if (point) {
        points.push(point);
      }
    }

    if (points.length > 0) {
      // Send as JSON GPSBatch (matches backend JSON decoding)
      const batch = JSON.stringify({ points });
      batchCount++;

      self.postMessage({
        type: 'batch',
        data: batch,
      });

      // Send driver positions for map visualization
      self.postMessage({
        type: 'stats',
        pointsGenerated: points.length,
        batchNumber: batchCount,
        drivers: points.map((p) => ({
          id: p.driver_id,
          lat: p.latitude,
          lng: p.longitude,
          isDeviating: drivers.find((d) => d.id === p.driver_id)?.isDeviating || false,
        })),
      });
    }
  }, 3000);

  // Notify start
  self.postMessage({
    type: 'started',
    driverCount: drivers.length,
    deviationPercent,
  });
}

function stopSimulation() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  drivers = [];
  batchCount = 0;
  self.postMessage({ type: 'stopped' });
}

/**
 * Generate the next GPS point for a driver.
 * If the driver is deviating, add a consistent offset to simulate going off-route.
 */
function generateNextPoint(driver) {
  const route = driver.route;
  if (!route || route.length === 0) return null;

  // Ping-pong along the route
  const waypoint = route[driver.routeIndex];
  driver.routeIndex += driver.direction;
  if (driver.routeIndex >= route.length) {
    driver.direction = -1;
    driver.routeIndex = route.length - 2;
  } else if (driver.routeIndex < 0) {
    driver.direction = 1;
    driver.routeIndex = 1;
  }

  let lat = waypoint.lat;
  let lng = waypoint.lng;

  // Add small GPS noise (±5m)
  lat += (Math.random() - 0.5) * 0.0001;
  lng += (Math.random() - 0.5) * 0.0001;

  // If deviating, add consistent larger offset
  if (driver.isDeviating) {
    lat += driver.deviationOffset.lat;
    lng += driver.deviationOffset.lng;
  }

  // Calculate approximate heading (degrees)
  const heading = driver.direction > 0
    ? Math.atan2(
        route[Math.min(driver.routeIndex, route.length - 1)].lng - waypoint.lng,
        route[Math.min(driver.routeIndex, route.length - 1)].lat - waypoint.lat,
      ) * (180 / Math.PI)
    : 0;

  return {
    driver_id: driver.id,
    trip_id: driver.tripId,
    latitude: lat,
    longitude: lng,
    timestamp: Date.now(),
    heading: ((heading % 360) + 360) % 360,
    speed: 15 + Math.random() * 45, // 15-60 km/h
  };
}
