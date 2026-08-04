/**
 * osrmRouting.js — OSRM Public API utilities.
 *
 * Road-Following Route: Snaps GPS traces to road network via /route API
 *   with BEARING constraints to prevent zigzagging between parallel roads.
 * Planned Route: Optimal driving route via intermediate waypoints
 * Nearest: Snap single point to nearest road
 *
 * KEY INSIGHT: Porto taxi GPS is sparse (15s intervals). When GPS points
 * fall near parallel roads (highway + service road), OSRM without bearings
 * will zigzag between them. By computing the bearing (heading direction)
 * from each GPS point to the next, we constrain OSRM to only use roads
 * that match the vehicle's actual direction of travel.
 */

const OSRM_BASE = 'https://router.project-osrm.org';
const TIMEOUT_MS = 15000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick N evenly-spaced items from an array, always including first and last */
function sample(arr, n) {
  if (arr.length <= n) return arr;
  const result = [arr[0]];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 1; i < n - 1; i++) result.push(arr[Math.round(i * step)]);
  result.push(arr[arr.length - 1]);
  return result;
}

/** Build an OSRM coordinate string */
function coordStr(coords) {
  return coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
}

/** Fetch with timeout */
async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── Bearing Calculation ──────────────────────────────────────────────────────

/**
 * calcBearing — Compute the compass bearing from point A to point B.
 * @param {number} lng1  longitude of A (degrees)
 * @param {number} lat1  latitude of A (degrees)
 * @param {number} lng2  longitude of B (degrees)
 * @param {number} lat2  latitude of B (degrees)
 * @returns {number}  bearing in degrees [0, 360)
 */
function calcBearing(lng1, lat1, lng2, lat2) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;

  const dLng = toRad(lng2 - lng1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const x = Math.sin(dLng) * Math.cos(phi2);
  const y = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);

  let bearing = toDeg(Math.atan2(x, y));
  return (bearing + 360) % 360;  // normalize to [0, 360)
}

/**
 * computeBearings — For each waypoint, compute the bearing to the NEXT point.
 * Last point uses the bearing from previous point (vehicle continues same direction).
 *
 * @param {Array<[number,number]>} coords  [lng,lat][]
 * @returns {string}  OSRM bearings parameter e.g. "90,45;180,45;..."
 *   Format: "bearing,range;bearing,range;..."  range=45 means ±45° tolerance
 */
function computeBearings(coords) {
  if (coords.length < 2) return '';

  const RANGE = 45;  // ±45 degree tolerance — wide enough for curves, narrow enough to avoid parallel roads
  const bearings = [];

  for (let i = 0; i < coords.length; i++) {
    if (i < coords.length - 1) {
      // Bearing from this point to next
      const b = calcBearing(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
      bearings.push(`${Math.round(b)},${RANGE}`);
    } else {
      // Last point: use same bearing as previous
      const b = calcBearing(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
      bearings.push(`${Math.round(b)},${RANGE}`);
    }
  }

  return bearings.join(';');
}

/**
 * Haversine distance in meters between two [lng,lat] points
 */
function haversineDistance(c1, c2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(c2[1] - c1[1]);
  const dLng = toRad(c2[0] - c1[0]);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(c1[1])) * Math.cos(toRad(c2[1])) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * cleanGpsTrace — Remove GPS outliers that jump too far from the trajectory.
 * If a point is >500m from both its predecessor and successor, it's an outlier.
 *
 * @param {Array<[number,number]>} coords
 * @returns {Array<[number,number]>}
 */
function cleanGpsTrace(coords) {
  if (coords.length <= 3) return coords;

  const cleaned = [coords[0]]; // always keep first

  for (let i = 1; i < coords.length - 1; i++) {
    const dPrev = haversineDistance(coords[i-1], coords[i]);
    const dNext = haversineDistance(coords[i], coords[i+1]);
    // If point jumps >500m from both neighbors → likely GPS glitch
    if (dPrev > 500 && dNext > 500) continue;
    cleaned.push(coords[i]);
  }

  cleaned.push(coords[coords.length - 1]); // always keep last
  return cleaned;
}

// ── Road-Following Route ─────────────────────────────────────────────────────

/**
 * routeChunk — Route through waypoints via OSRM /route API WITH bearings.
 * Bearings prevent zigzagging between parallel roads.
 *
 * @param {Array<[number,number]>} coords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
async function routeChunk(coords) {
  if (coords.length < 2) return null;

  // OSRM /route: max ~100 waypoints
  const limited = coords.length > 100 ? sample(coords, 100) : coords;

  const bearingsStr = computeBearings(limited);

  const url = `${OSRM_BASE}/route/v1/driving/${coordStr(limited)}`
    + `?overview=full&geometries=geojson&continue_straight=true`
    + `&bearings=${bearingsStr}`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) {
      console.warn('[OSRM route chunk] failed:', data.code, data.message);
      // Fallback: try without bearings (some edge cases)
      return routeChunkNoBearings(limited);
    }
    return data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('[OSRM route chunk]', err.message);
    return routeChunkNoBearings(limited);
  }
}

/** Fallback route without bearings */
async function routeChunkNoBearings(coords) {
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr(coords)}`
    + `?overview=full&geometries=geojson&continue_straight=true`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry.coordinates;
  } catch {
    return null;
  }
}

/**
 * matchTripToRoads — Snaps a full GPS trace to the road network.
 *
 * Pipeline:
 *   1. Clean GPS trace (remove outliers >500m from neighbors)
 *   2. Sample to manageable waypoint count
 *   3. Route via OSRM with bearing constraints
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Step 1: Clean outliers
  const cleaned = cleanGpsTrace(rawCoords);
  console.log(`[matchTripToRoads] ${rawCoords.length} raw → ${cleaned.length} cleaned`);

  // Short trip — direct
  if (cleaned.length <= 100) {
    return routeChunk(cleaned);
  }

  // Medium trip — sample to 80
  if (cleaned.length <= 500) {
    return routeChunk(sample(cleaned, 80));
  }

  // Long trip — chunk
  const WAYPOINTS = 60;
  const OVERLAP   = 5;
  const sampled   = sample(cleaned, 200);

  const chunks = [];
  for (let i = 0; i < sampled.length; i += (WAYPOINTS - OVERLAP)) {
    const end = Math.min(i + WAYPOINTS, sampled.length);
    chunks.push(sampled.slice(i, end));
    if (end >= sampled.length) break;
  }

  const results = [];
  for (const chunk of chunks) {
    results.push(await routeChunk(chunk));
    await new Promise(r => setTimeout(r, 300));
  }

  const merged = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) continue;
    if (i === 0) {
      merged.push(...results[i]);
    } else {
      const skip = Math.min(10, Math.floor(results[i].length * 0.1));
      merged.push(...results[i].slice(skip));
    }
  }
  return merged.length >= 2 ? merged : null;
}

// ── Planned Route ────────────────────────────────────────────────────────────

/**
 * getPlannedRoute — Optimal driving route via intermediate waypoints.
 * NO bearings here — planned route = "what the optimal path would be"
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function getPlannedRoute(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  const waypoints = sample(rawCoords, Math.min(rawCoords.length, 12));

  const url = `${OSRM_BASE}/route/v1/driving/${coordStr(waypoints)}`
    + `?overview=full&geometries=geojson`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('[OSRM route planned]', err.message);
    return null;
  }
}

// ── Nearest Road Snap ─────────────────────────────────────────────────────────

export async function snapPointToRoad(lng, lat) {
  const url = `${OSRM_BASE}/nearest/v1/driving/${lng.toFixed(6)},${lat.toFixed(6)}?number=1`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.waypoints?.length) return null;
    return data.waypoints[0].location;
  } catch {
    return null;
  }
}

export async function snapPointsBatch(coords, concurrency = 6) {
  const results = new Array(coords.length).fill(null);
  for (let i = 0; i < coords.length; i += concurrency) {
    const batch = coords.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(([lng, lat]) => snapPointToRoad(lng, lat))
    );
    batchResults.forEach((r, j) => { results[i + j] = r; });
    if (i + concurrency < coords.length) {
      await new Promise(res => setTimeout(res, 120));
    }
  }
  return results;
}
