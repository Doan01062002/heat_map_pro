/**
 * osrmRouting.js — OSRM Public API utilities for map matching and routing.
 *
 * Uses the public OSRM demo server (router.project-osrm.org) which covers
 * worldwide roads including Porto, Portugal.
 *
 * Map Matching: Snaps raw GPS traces to the road network
 * Routing: Computes the optimal planned route between two points
 */

const OSRM_BASE = 'https://router.project-osrm.org';

/**
 * Sample an array of coordinates down to maxPoints evenly spaced samples.
 * OSRM match API accepts max 100 coordinates per request.
 */
function sampleCoords(coords, maxPoints = 100) {
  if (coords.length <= maxPoints) return coords;
  const result = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    result.push(coords[Math.round(i * step)]);
  }
  return result;
}

/**
 * matchTripToRoads — Snaps raw GPS coordinates to the road network.
 * Returns road-snapped [lng, lat] coordinate array, or null on failure.
 *
 * @param {Array<[number,number]>} rawCoords  Array of [lng, lat] pairs
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // OSRM match allows max 100 points per request
  const sampled = sampleCoords(rawCoords, 100);
  const coordStr = sampled.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');

  try {
    const url = `${OSRM_BASE}/match/v1/driving/${coordStr}?overview=full&geometries=geojson&tidy=true&gaps=split`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    if (data.code !== 'Ok' || !data.matchings?.length) {
      console.warn('[OSRM match] failed:', data.code, data.message);
      return null;
    }

    // Merge coordinates from all matching segments
    const allCoords = data.matchings.flatMap(m => m.geometry.coordinates);
    return allCoords;
  } catch (err) {
    console.warn('[OSRM match] request failed:', err.message);
    return null;
  }
}

/**
 * getPlannedRoute — Computes the optimal driving route from origin to destination.
 * Returns road-following [lng, lat] coordinate array, or null on failure.
 *
 * @param {[number,number]} start  [lng, lat]
 * @param {[number,number]} end    [lng, lat]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function getPlannedRoute(start, end) {
  if (!start || !end) return null;

  try {
    const coordStr = `${start[0].toFixed(6)},${start[1].toFixed(6)};${end[0].toFixed(6)},${end[1].toFixed(6)}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();

    if (data.code !== 'Ok' || !data.routes?.length) {
      console.warn('[OSRM route] failed:', data.code, data.message);
      return null;
    }

    return data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('[OSRM route] request failed:', err.message);
    return null;
  }
}
