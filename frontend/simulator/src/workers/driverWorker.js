/**
 * driverWorker.js — Web Worker for simulating GPS traces.
 *
 * This worker runs in a separate thread, generating GPS coordinates
 * for a batch of virtual drivers. It posts Protobuf-encoded GPSBatch
 * messages back to the main thread every 3 seconds.
 *
 * Messages IN (from main thread):
 *   { type: 'start', driverIds: string[], routes: Route[], deviationPercent: number }
 *   { type: 'stop' }
 *
 * Messages OUT (to main thread):
 *   { type: 'batch', data: ArrayBuffer }  // Protobuf-encoded GPSBatch
 *   { type: 'stats', pointsGenerated: number }
 */

let intervalId = null;
let drivers = [];

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

function startSimulation({ driverIds, routes, deviationPercent }) {
  if (intervalId) {
    clearInterval(intervalId);
  }

  // Initialize driver state
  drivers = driverIds.map((id, index) => ({
    id,
    tripId: `trip-${id}-${Date.now()}`,
    route: routes[index % routes.length],
    routeIndex: 0,
    isDeviating: Math.random() * 100 < deviationPercent,
  }));

  // Generate GPS batches every 3 seconds
  intervalId = setInterval(() => {
    const points = drivers.map((driver) => {
      const point = generateNextPoint(driver);
      return point;
    });

    // TODO: Encode points as Protobuf GPSBatch and post back
    // For now, post raw JSON (will be replaced with Protobuf encoding)
    self.postMessage({
      type: 'batch',
      data: JSON.stringify(points), // TODO: Replace with Protobuf binary
    });

    self.postMessage({
      type: 'stats',
      pointsGenerated: points.length,
    });
  }, 3000);
}

function stopSimulation() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  drivers = [];
}

/**
 * Generate the next GPS point for a driver.
 * If the driver is deviating, add random offset to simulate going off-route.
 */
function generateNextPoint(driver) {
  const route = driver.route;
  if (!route || route.length === 0) {
    return null;
  }

  // Advance along the route
  const waypoint = route[driver.routeIndex % route.length];
  driver.routeIndex++;

  let lat = waypoint.latitude;
  let lng = waypoint.longitude;

  // Add GPS noise (±5m)
  lat += (Math.random() - 0.5) * 0.0001;
  lng += (Math.random() - 0.5) * 0.0001;

  // If deviating, add larger offset (100-500m)
  if (driver.isDeviating && Math.random() < 0.3) {
    lat += (Math.random() - 0.5) * 0.005;
    lng += (Math.random() - 0.5) * 0.005;
  }

  return {
    driver_id: driver.id,
    trip_id: driver.tripId,
    latitude: lat,
    longitude: lng,
    timestamp: Date.now(),
    heading: Math.random() * 360,
    speed: 20 + Math.random() * 40,
  };
}
