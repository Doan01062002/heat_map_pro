/**
 * h3Worker.js — Web Worker for H3 hexagon computation.
 *
 * Offloads `latLngToCell` + `cellToBoundary` from the React main thread
 * to prevent UI freezes when processing 386k+ GPS points.
 *
 * Message API:
 *   IN:  { type: 'compute', points: GPSPoint[], resolution: number, bounds: BBox|null }
 *   OUT: { type: 'result', h3GeoJSON: GeoJSON, actualPathH3GeoJSON: GeoJSON }
 *        { type: 'error',  message: string }
 *
 * BBox: { minLat, maxLat, minLng, maxLng } — when provided, only points inside
 *       the viewport are processed (viewport culling at resolution >= 11).
 */
import { latLngToCell, cellToBoundary } from 'h3-js';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build H3 deviation heatmap GeoJSON from points
// ─────────────────────────────────────────────────────────────────────────────
function buildH3GeoJSON(points, resLevel) {
  const h3CellMap = new Map();
  let maxAvoidScore = 1;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!pt.lat || !pt.lng) continue;

    const cell = latLngToCell(pt.lat, pt.lng, resLevel);
    const isAvoidance = (pt.deviation || 0) > 150;
    const tripKey =
      pt.trip_id ||
      (pt.driver_id
        ? `driver-${pt.driver_id}`
        : `cluster-${Math.floor(pt.lat * 250)},${Math.floor(pt.lng * 250)}`);

    const item = h3CellMap.get(cell);
    if (!item) {
      const totalTripsSet = new Set([tripKey]);
      const avoidTripsSet = new Set();
      if (isAvoidance) avoidTripsSet.add(tripKey);
      h3CellMap.set(cell, {
        cell,
        count: 1,
        totalTripsSet,
        avoidTripsSet,
        totalDev: pt.deviation || 0,
        maxDev: pt.deviation || 0,
      });
    } else {
      item.count++;
      item.totalTripsSet.add(tripKey);
      if (isAvoidance) item.avoidTripsSet.add(tripKey);
      item.totalDev += pt.deviation || 0;
      item.maxDev = Math.max(item.maxDev, pt.deviation || 0);
    }
  }

  for (const item of h3CellMap.values()) {
    const avoidScore = item.avoidTripsSet.size;
    if (avoidScore > maxAvoidScore) maxAvoidScore = avoidScore;
  }

  const features = [];
  for (const item of h3CellMap.values()) {
    try {
      const boundary = cellToBoundary(item.cell, true);
      if (!boundary || boundary.length === 0) continue;

      const avoidTripsCount = item.avoidTripsSet.size;
      const totalTripsCount = item.totalTripsSet.size;
      const ratio = maxAvoidScore > 0 ? avoidTripsCount / maxAvoidScore : 0;
      const avgDev = Math.round(item.totalDev / item.count);

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [boundary] },
        properties: {
          h3Index: item.cell,
          count: item.count,
          avoidTripsCount,
          totalTripsCount,
          ratio,
          res: resLevel,
          height: Math.max(10, Math.round(ratio * 250)),
          avgDev,
          maxDev: Math.round(item.maxDev),
        },
      });
    } catch (_) { /* ignore invalid cells */ }
  }

  return { type: 'FeatureCollection', features };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build actual-path H3 extrusion GeoJSON (deviation paths only)
// ─────────────────────────────────────────────────────────────────────────────
function buildActualPathGeoJSON(points, resLevel) {
  const h3CellMap = new Map();

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!pt.lat || !pt.lng) continue;
    if (!((pt.deviation || 0) > 150)) continue;

    const cell = latLngToCell(pt.lat, pt.lng, resLevel);
    const tripKey =
      pt.trip_id ||
      (pt.driver_id
        ? `driver-${pt.driver_id}`
        : `cluster-${Math.floor(pt.lat * 250)},${Math.floor(pt.lng * 250)}`);

    const item = h3CellMap.get(cell);
    if (!item) {
      const dSet = new Set();
      if (pt.driver_id) dSet.add(pt.driver_id);
      h3CellMap.set(cell, {
        h3Index: cell,
        intensity: 1,
        uniqueTripsSet: new Set([tripKey]),
        uniqueDriversSet: dSet,
      });
    } else {
      item.intensity++;
      item.uniqueTripsSet.add(tripKey);
      if (pt.driver_id) item.uniqueDriversSet.add(pt.driver_id);
    }
  }

  let maxTrips = 1;
  for (const item of h3CellMap.values()) {
    if (item.uniqueTripsSet.size > maxTrips) maxTrips = item.uniqueTripsSet.size;
  }

  const features = [];
  for (const item of h3CellMap.values()) {
    try {
      const boundary = cellToBoundary(item.h3Index, true);
      if (!boundary || boundary.length === 0) continue;

      const ratio = maxTrips > 0 ? item.uniqueTripsSet.size / maxTrips : 0;
      const height = Math.max(10, Math.round(ratio * 220));

      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [boundary] },
        properties: {
          h3Index: item.h3Index,
          intensity: item.intensity,
          uniqueDrivers: item.uniqueDriversSet.size,
          uniqueTrips: item.uniqueTripsSet.size,
          ratio,
          height,
        },
      });
    } catch (_) { /* ignore invalid cells */ }
  }

  return { type: 'FeatureCollection', features };
}

// ─────────────────────────────────────────────────────────────────────────────
// Message handler
// ─────────────────────────────────────────────────────────────────────────────
self.onmessage = (event) => {
  const { type, points, resolution, bounds } = event.data;
  if (type !== 'compute') return;

  try {
    // Viewport culling: at res >= 11 (street level), only process points inside
    // the visible map bounds + 0.02° padding so edge hexagons render correctly.
    // At res 9-10 (city-wide), always use all points for a complete heatmap.
    let workingPoints = points;
    if (bounds && resolution >= 11) {
      const { minLat, maxLat, minLng, maxLng } = bounds;
      const PAD = 0.02; // ~2 km padding
      workingPoints = points.filter(
        (p) =>
          p.lat >= minLat - PAD &&
          p.lat <= maxLat + PAD &&
          p.lng >= minLng - PAD &&
          p.lng <= maxLng + PAD
      );
    }

    const h3GeoJSON = buildH3GeoJSON(workingPoints, resolution);
    const actualPathH3GeoJSON = buildActualPathGeoJSON(workingPoints, resolution);

    self.postMessage({ type: 'result', h3GeoJSON, actualPathH3GeoJSON });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
