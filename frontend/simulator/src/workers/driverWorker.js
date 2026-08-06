/**
 * driverWorker.js — Web Worker for simulating GPS traces along OSRM routes.
 */

let intervalId = null;
let drivers = [];
let batchCount = 0;

self.onmessage = function (event) {
  const { type } = event.data;

  switch (type) {
    case 'start_single':
      startSingleDriverSimulation(event.data);
      break;
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

function startSingleDriverSimulation({ driverId, routeCoords, deviationPercent }) {
  if (intervalId) clearInterval(intervalId);
  batchCount = 0;

  if (!routeCoords || routeCoords.length === 0) return;

  const tripId = `trip-${driverId || 'DRV-SIM'}-${Date.now()}`;
  let routeIndex = 0;

  intervalId = setInterval(() => {
    if (routeIndex >= routeCoords.length) {
      routeIndex = 0; // Loop back
    }

    const [lng, lat] = routeCoords[routeIndex];
    const prevCoord = routeCoords[Math.max(0, routeIndex - 1)];

    let heading = 0;
    if (prevCoord) {
      heading = Math.atan2(lng - prevCoord[0], lat - prevCoord[1]) * (180 / Math.PI);
      heading = ((heading % 360) + 360) % 360;
    }

    const isDev = routeIndex > 5 && Math.random() * 100 < deviationPercent;

    const point = {
      driver_id: driverId || 'DRV-SIMULATOR',
      trip_id: tripId,
      latitude: lat,
      longitude: lng,
      timestamp: Date.now(),
      heading,
      speed: 35 + Math.random() * 20,
    };

    batchCount++;
    const batch = JSON.stringify({ points: [point] });

    self.postMessage({ type: 'batch', data: batch });
    self.postMessage({
      type: 'stats',
      pointsGenerated: 1,
      batchNumber: batchCount,
      drivers: [{
        id: point.driver_id,
        lat: point.latitude,
        lng: point.longitude,
        isDeviating: isDev,
      }],
    });

    routeIndex++;
  }, 2000);
}

function startSimulation({ driverCount, deviationPercent }) {
  if (intervalId) clearInterval(intervalId);
  batchCount = 0;

  // Generic fallback if multi-driver simulation is requested
  drivers = [];
  for (let i = 0; i < driverCount; i++) {
    drivers.push({
      id: `d-${String(i + 1).padStart(3, '0')}`,
      tripId: `trip-d-${i}-${Date.now()}`,
      routeIndex: 0,
      isDeviating: Math.random() * 100 < deviationPercent,
    });
  }
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
