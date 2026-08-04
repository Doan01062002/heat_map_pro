/**
 * osrmRouting.js — OSRM Public API utilities.
 *
 * Road-Following Route: Snaps GPS traces to road network via /route API.
 *   Uses H3 spatial indexing to extract clean waypoints from noisy GPS.
 * Planned Route: Optimal driving route via intermediate waypoints.
 * Nearest: Snap single point to nearest road.
 *
 * H3 APPROACH for actual route:
 *   - Convert GPS points → H3 cells at resolution 11 (~25m hexagons)
 *   - Deduplicate: consecutive GPS noise in same cell → 1 waypoint
 *   - Use H3 cell CENTERS as waypoints → grid-aligned, consistent
 *   - Route between consecutive cell centers pairwise → no loops
 *
 * BEARING: each pair uses the heading from A→B to constrain OSRM
 *   to roads matching the vehicle's travel direction.
 */

import { latLngToCell, cellToLatLng } from 'h3-js';

const OSRM_BASE  = 'https://router.project-osrm.org';
const TIMEOUT_MS = 15000;
// H3 resolution 11 = ~25m hexagons — fine enough for urban routing,
// coarse enough to merge nearby GPS noise into one waypoint.
const H3_RESOLUTION = 11;

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

// ── H3-Based Waypoint Extraction ─────────────────────────────────────────────

/**
 * gpsToH3Waypoints — Convert a GPS trace to H3 cell centers.
 *
 * How it works:
 *   1. Each GPS [lng,lat] → H3 cell at resolution 11 (~25m hexagon)
 *   2. Consecutive duplicate cells (GPS noise in same spot) → merged into 1
 *   3. Cell CENTER coordinates returned as [lng,lat] waypoints
 *
 * Why H3 helps:
 *   - GPS noise (±5-20m) often falls in same H3 cell → natural dedup
 *   - Cell centers lie on a consistent hexagonal grid → no random jitter
 *   - Reduces 200+ GPS points to ~15-30 key turn points
 *   - Can later compare actual vs planned routes by H3 cell overlap
 *
 * @param {Array<[number,number]>} coords  [lng,lat][] raw GPS
 * @param {number} resolution  H3 resolution (default 11 = ~25m)
 * @returns {Array<[number,number]>}  [lng,lat][] of unique H3 cell centers
 */
function gpsToH3Waypoints(coords, resolution = H3_RESOLUTION) {
  const waypoints = [];
  let prevCell = null;

  for (const [lng, lat] of coords) {
    const cell = latLngToCell(lat, lng, resolution);  // h3-js: (lat, lng, res)
    if (cell !== prevCell) {
      const [cellLat, cellLng] = cellToLatLng(cell);  // h3-js returns [lat, lng]
      waypoints.push([cellLng, cellLat]);              // convert back to [lng, lat]
      prevCell = cell;
    }
  }

  return waypoints;
}

/**
 * computeH3Overlap — Given actual GPS and planned route coords,
 * compute what % of the actual route overlaps with the planned route
 * by comparing H3 cells at resolution 10 (~65m hexagons).
 *
 * Useful for deviation analysis: 0% = completely different roads,
 * 100% = exact same roads.
 *
 * @param {Array<[number,number]>} actualCoords   [lng,lat][]
 * @param {Array<[number,number]>} plannedCoords  [lng,lat][]
 * @param {number} resolution  H3 resolution for comparison (default 10)
 * @returns {{ overlapRatio: number, actualCells: Set, plannedCells: Set }}
 */
export function computeH3Overlap(actualCoords, plannedCoords, resolution = 10) {
  const actualCells  = new Set(actualCoords.map(([lng, lat]) => latLngToCell(lat, lng, resolution)));
  const plannedCells = new Set(plannedCoords.map(([lng, lat]) => latLngToCell(lat, lng, resolution)));
  const shared = [...actualCells].filter(c => plannedCells.has(c)).length;
  const overlapRatio = actualCells.size > 0 ? shared / actualCells.size : 0;
  return { overlapRatio, actualCells, plannedCells };
}


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
 * perpDistance — Perpendicular distance from point P to line A→B (in meters).
 * Used by Douglas-Peucker algorithm.
 */
function perpDistance(p, a, b) {
  // If A and B are the same point, return distance A→P
  const dAB = haversineDistance(a, b);
  if (dAB < 1) return haversineDistance(a, p);

  // Use cross-track distance formula (simplified for short distances)
  const dAP = haversineDistance(a, p);
  const dBP = haversineDistance(b, p);

  // Heron's formula for triangle area → height = perpendicular distance
  const s = (dAB + dAP + dBP) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - dAB) * (s - dAP) * (s - dBP)));
  return (2 * area) / dAB;
}

/**
 * douglasPeucker — Simplify a polyline by removing points that don't
 * significantly change the shape. Keeps the overall path but removes
 * micro-oscillations and near-collinear points.
 *
 * @param {Array<[number,number]>} coords
 * @param {number} tolerance  max allowed distance from simplified line (meters)
 * @returns {Array<[number,number]>}
 */
function douglasPeucker(coords, tolerance = 25) {
  if (coords.length <= 2) return coords;

  // Find point furthest from the line start→end
  let maxDist = 0;
  let maxIdx  = 0;
  const first = coords[0];
  const last  = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const d = perpDistance(coords[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx  = i;
    }
  }

  if (maxDist > tolerance) {
    // Recursively simplify both halves
    const left  = douglasPeucker(coords.slice(0, maxIdx + 1), tolerance);
    const right = douglasPeucker(coords.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    // All intermediate points are within tolerance → keep only endpoints
    return [first, last];
  }
}

/**
 * cleanGpsTrace — Comprehensive GPS trace simplification pipeline.
 *
 * Steps:
 *   1. Remove near-duplicate points (< 30m from previous)
 *   2. Remove outliers (> 500m from both neighbors)
 *   3. Remove U-turn loops (returns within 80m of a point 2-4 steps back)
 *   4. Douglas-Peucker simplification (25m tolerance)
 *
 * @param {Array<[number,number]>} coords  [lng,lat][]
 * @returns {Array<[number,number]>}  simplified trace
 */
function cleanGpsTrace(coords) {
  if (coords.length <= 3) return coords;

  // Step 1: Remove near-duplicates (< 30m apart)
  let pass1 = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (haversineDistance(pass1[pass1.length - 1], coords[i]) >= 30) {
      pass1.push(coords[i]);
    }
  }
  // Always keep last point
  if (pass1[pass1.length - 1] !== coords[coords.length - 1]) {
    pass1.push(coords[coords.length - 1]);
  }

  // Step 2: Remove outliers (> 500m from both neighbors)
  let pass2 = [pass1[0]];
  for (let i = 1; i < pass1.length - 1; i++) {
    const dPrev = haversineDistance(pass1[i - 1], pass1[i]);
    const dNext = haversineDistance(pass1[i], pass1[i + 1]);
    if (!(dPrev > 500 && dNext > 500)) {
      pass2.push(pass1[i]);
    }
  }
  pass2.push(pass1[pass1.length - 1]);

  // Step 3: Remove U-turn loops
  // If point i is within 80m of point i-3 or i-4, the vehicle likely
  // circled back — remove intermediate points to avoid OSRM creating loops
  let pass3 = [pass2[0]];
  for (let i = 1; i < pass2.length; i++) {
    let isLoop = false;
    // Check if current point is very close to a point 2-4 steps back
    for (let lookback = 2; lookback <= Math.min(4, pass3.length); lookback++) {
      const prevPt = pass3[pass3.length - lookback];
      if (prevPt && haversineDistance(prevPt, pass2[i]) < 80) {
        isLoop = true;
        break;
      }
    }
    if (!isLoop) {
      pass3.push(pass2[i]);
    }
  }
  // Ensure last point
  if (pass3[pass3.length - 1] !== pass2[pass2.length - 1]) {
    pass3.push(pass2[pass2.length - 1]);
  }

  // Step 4: Douglas-Peucker simplification (25m tolerance)
  const simplified = douglasPeucker(pass3, 25);

  console.log(`[cleanGpsTrace] ${coords.length} → dedup:${pass1.length} → outlier:${pass2.length} → uloop:${pass3.length} → DP:${simplified.length}`);

  return simplified;
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
 *   1. Clean GPS trace (dedup <30m, outliers >500m, U-turns, DP simplify)
 *   2. H3 spatial indexing → convert GPS to H3 cell centers at res 11 (~25m)
 *      Each unique H3 cell = 1 waypoint; consecutive duplicates merged
 *   3. Pairwise OSRM routing: route A→B, B→C, ... (no all-in-one = no loops)
 *   4. Stitch segments into final route
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Step 1: Clean GPS trace (dedup, outliers, U-turns, DP at 25m)
  const cleaned = cleanGpsTrace(rawCoords);

  // Step 2: H3 spatial indexing → extract key waypoints
  // Resolution 11 (~25m cells): merges GPS noise in same cell → 1 waypoint
  // Use resolution 10 (~65m) if trace is very dense to get fewer waypoints
  let h3Waypoints = gpsToH3Waypoints(cleaned, H3_RESOLUTION);

  // If H3 gives too many (>30), use coarser resolution
  if (h3Waypoints.length > 30) {
    h3Waypoints = gpsToH3Waypoints(cleaned, H3_RESOLUTION - 1); // res 10 = ~65m
  }

  // Fallback: if H3 gives too few, use sampled cleaned points
  let waypoints;
  if (h3Waypoints.length < 2) {
    waypoints = sample(cleaned, Math.min(cleaned.length, 10));
  } else {
    waypoints = h3Waypoints;
  }

  console.log(`[matchTripToRoads] ${rawCoords.length} raw → ${cleaned.length} cleaned → H3(res${H3_RESOLUTION}):${h3Waypoints.length} → ${waypoints.length} waypoints`);

  if (waypoints.length < 2) return null;

  // Step 3: Pairwise segment routing
  // Route each consecutive PAIR of waypoints separately:
  //   A→B, B→C, C→D, ...
  // Each pair = simple 2-point route → NO loops possible!
  const segments = [];
  const BATCH_SIZE = 4;  // process 4 pairs in parallel to speed up
  
  for (let i = 0; i < waypoints.length - 1; i += BATCH_SIZE) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH_SIZE, waypoints.length - 1); j++) {
      batch.push(routePair(waypoints[j], waypoints[j + 1]));
    }
    const results = await Promise.all(batch);
    segments.push(...results);

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < waypoints.length - 1) {
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Step 4: Stitch segments together (skip duplicate junction points)
  const merged = [];
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i] || segments[i].length === 0) continue;
    if (merged.length === 0) {
      merged.push(...segments[i]);
    } else {
      // Skip first point of this segment (it's the same as last point of previous)
      merged.push(...segments[i].slice(1));
    }
  }

  console.log(`[matchTripToRoads] ${segments.length} segments → ${merged.length} total route coords`);
  return merged.length >= 2 ? merged : null;
}

/**
 * routePair — Route between exactly 2 points via OSRM.
 * Simple A→B route, no loops possible.
 */
async function routePair(coordA, coordB) {
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr([coordA, coordB])}`
    + `?overview=full&geometries=geojson&continue_straight=true`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry.coordinates;
  } catch {
    return null;
  }
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
