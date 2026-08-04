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
 * matchTripToRoads — Snaps a GPS trace to road network using OSRM /match HMM.
 *
 * Strategy (researched + tested against public OSRM server limits):
 *   - /match API uses Hidden Markov Model: considers ALL GPS points together,
 *     finds the most LIKELY sequence of roads — unlike /route which just finds
 *     the shortest path between two arbitrary waypoints.
 *   - Public server limit: max 10 points per /match request, radius ≤ 40m
 *   - Solution: chunk GPS into groups of 10 with 2-point overlap, stitch results
 *   - Use timestamps (15s intervals = Porto dataset) for HMM transition scoring
 *   - tidy=true: OSRM cleans internal GPS noise before matching
 *   - gaps=ignore: bridge gaps without splitting the trace
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @param {number} [intervalSeconds=15]  GPS sampling interval (Porto = 15s)
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords, intervalSeconds = 15) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Step 1: Remove only hard outliers (>500m from both neighbors = GPS glitch).
  // Keep mild noise — the HMM in /match handles it better than we ever could.
  const cleaned = removeOutliers(rawCoords);
  if (cleaned.length < 2) return null;

  // Step 2: Sample to ≤100 points to limit total API calls.
  // Porto trips average 60-80 GPS points → usually no sampling needed.
  const sampled = cleaned.length > 100
    ? sample(cleaned, 100)
    : cleaned;

  console.log(`[matchTripToRoads] ${rawCoords.length} raw → ${cleaned.length} cleaned → ${sampled.length} sampled`);

  // Step 3: Chunk into groups of 10 with 2-point overlap.
  // /match limit: 10 coords max, radius ≤ 40m on public server.
  // Overlap ensures route continuity at chunk boundaries.
  const CHUNK_SIZE = 10;
  const OVERLAP    = 2;
  const chunks     = [];
  for (let i = 0; i < sampled.length; i += CHUNK_SIZE - OVERLAP) {
    const end = Math.min(i + CHUNK_SIZE, sampled.length);
    chunks.push(sampled.slice(i, end));
    if (end >= sampled.length) break;
  }

  // Step 4: Match each chunk via /match HMM, sequentially to respect rate limits.
  // Each chunk gets synthetic timestamps: 0, 15, 30, ... seconds
  const matchedSegments = [];
  let failCount = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const matched = await matchChunk(chunk, intervalSeconds);
    if (matched) {
      matchedSegments.push(matched);
    } else {
      failCount++;
      // Fallback for this chunk: pairwise /route between first and last point
      console.warn(`[matchTripToRoads] chunk ${ci} /match failed → using /route fallback`);
      const fallback = await routePairNoBearing(chunk[0], chunk[chunk.length - 1]);
      if (fallback) matchedSegments.push(fallback);
    }
    // Throttle between chunks: 200ms gap to avoid rate-limiting
    if (ci < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (matchedSegments.length === 0) return null;

  // Step 5: Stitch segments together.
  // Skip first OVERLAP coords of each segment (they overlap with previous chunk).
  const merged = [];
  for (let i = 0; i < matchedSegments.length; i++) {
    const seg = matchedSegments[i];
    if (!seg || seg.length === 0) continue;
    if (merged.length === 0) {
      merged.push(...seg);
    } else {
      // Skip the first ~(OVERLAP) points to avoid doubling the junction
      const skip = Math.min(OVERLAP, Math.floor(seg.length * 0.15));
      merged.push(...seg.slice(skip));
    }
  }

  console.log(`[matchTripToRoads] ${chunks.length} chunks, ${failCount} fallbacks → ${merged.length} final coords`);
  return merged.length >= 2 ? merged : null;
}

/**
 * removeOutliers — Lightweight pass: only remove GPS points that are
 * clearly impossible (>500m from BOTH neighbors = satellite glitch).
 * Keep all other noise — OSRM HMM handles it.
 */
function removeOutliers(coords) {
  if (coords.length <= 3) return coords;
  const out = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const dPrev = haversineDistance(coords[i - 1], coords[i]);
    const dNext = haversineDistance(coords[i], coords[i + 1]);
    if (!(dPrev > 500 && dNext > 500)) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/**
 * matchChunk — Send a chunk of ≤10 GPS points to OSRM /match HMM API.
 * Uses synthetic timestamps (15s intervals) and radius=40m.
 *
 * @param {Array<[number,number]>} coords  [lng,lat][] — max 10 points
 * @param {number} intervalSeconds  time gap between consecutive GPS points
 * @returns {Promise<Array<[number,number]>|null>}
 */
async function matchChunk(coords, intervalSeconds = 15) {
  if (coords.length < 2) return null;

  const coordPart    = coordStr(coords);
  const radiusPart   = coords.map(() => '40').join(';');
  // Synthetic timestamps starting at 0, incrementing by intervalSeconds
  const tsPart       = coords.map((_, i) => i * intervalSeconds).join(';');

  const url = `${OSRM_BASE}/match/v1/driving/${coordPart}`
    + `?overview=full&geometries=geojson`
    + `&radiuses=${radiusPart}`
    + `&timestamps=${tsPart}`
    + `&tidy=true&gaps=ignore`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.matchings?.length) {
      console.warn('[matchChunk] failed:', data.code, data.message);
      return null;
    }
    // Merge all matchings (gaps=ignore may still produce multiple matchings)
    const allCoords = [];
    for (const m of data.matchings) {
      if (allCoords.length === 0) {
        allCoords.push(...m.geometry.coordinates);
      } else {
        allCoords.push(...m.geometry.coordinates.slice(1));
      }
    }
    return allCoords;
  } catch (err) {
    console.warn('[matchChunk] error:', err.message);
    return null;
  }
}


/**
 * snapToNearestRoad — Snap a coordinate to the nearest road node
 * via OSRM /nearest API. Returns the snapped road coordinate,
 * or the original if the API fails.
 *
 * This is the KEY fix: H3 cell centers may be in the middle of a block.
 * Snapping them to the road network ensures OSRM routes FROM a road node,
 * not from an arbitrary point that triggers long detours to reach.
 *
 * @param {[number,number]} coord  [lng,lat]
 * @returns {Promise<[number,number]>}  snapped [lng,lat] on nearest road
 */
async function snapToNearestRoad(coord) {
  const url = `${OSRM_BASE}/nearest/v1/driving/${coord[0].toFixed(6)},${coord[1].toFixed(6)}?number=1`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.waypoints?.length) return coord;
    return data.waypoints[0].location; // [lng, lat] already on road
  } catch {
    return coord; // fall back to original
  }
}

/**
 * routePairWithBearing — Route between 2 road-snapped points with
 * bearing constraint. The bearing from A→B is computed and passed to
 * OSRM so it only uses road segments matching the travel direction.
 *
 * @param {[number,number]} coordA  [lng,lat] — already road-snapped
 * @param {[number,number]} coordB  [lng,lat] — already road-snapped
 * @returns {Promise<Array<[number,number]>|null>}
 */
async function routePairWithBearing(coordA, coordB) {
  const bearing = Math.round(calcBearing(coordA[0], coordA[1], coordB[0], coordB[1]));
  // Use ±35° tolerance: tight enough to reject parallel roads,
  // loose enough to handle curved roads and slight GPS offsets
  const bearStr = `${bearing},35;${bearing},35`;

  const url = `${OSRM_BASE}/route/v1/driving/${coordStr([coordA, coordB])}`
    + `?overview=full&geometries=geojson&continue_straight=true`
    + `&bearings=${bearStr}`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) {
      // Fallback: route without bearing constraint
      return routePairNoBearing(coordA, coordB);
    }
    return data.routes[0].geometry.coordinates;
  } catch {
    return routePairNoBearing(coordA, coordB);
  }
}

/** Fallback: 2-point route without bearing */
async function routePairNoBearing(coordA, coordB) {
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
