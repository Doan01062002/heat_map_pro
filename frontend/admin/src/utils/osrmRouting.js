/**
 * osrmRouting.js — OSRM Public API utilities.
 *
 * Map Matching: Snaps GPS traces to road network (chunked for long trips)
 * Routing: Planned route via intermediate waypoints (not just start→end)
 */

const OSRM_BASE = 'https://router.project-osrm.org';
const TIMEOUT_MS = 12000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick N evenly-spaced items from an array */
function sample(arr, n) {
  if (arr.length <= n) return arr;
  const result = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) result.push(arr[Math.round(i * step)]);
  return result;
}

/** Build an OSRM coordinate string */
function coordStr(coords) {
  return coords.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
}

/** Fetch with timeout */
async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── Map Matching ──────────────────────────────────────────────────────────────

/**
 * matchChunk — Match a single chunk of ≤100 coordinates to the road network.
 * Returns matched coordinates or null.
 */
async function matchChunk(coords) {
  if (coords.length < 2) return null;
  const radii = coords.map(() => '25').join(';');
  const url = `${OSRM_BASE}/match/v1/driving/${coordStr(coords)}`
    + `?overview=full&geometries=geojson&gaps=ignore&radiuses=${radii}`;
  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.matchings?.length) return null;
    return data.matchings.flatMap(m => m.geometry.coordinates);
  } catch (err) {
    console.warn('[OSRM match chunk]', err.message);
    return null;
  }
}

/**
 * matchTripToRoads — Snaps full GPS trace to roads.
 * Automatically chunks long trips into overlapping 80-point segments.
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  const CHUNK_SIZE = 80;
  const OVERLAP    = 8;

  // Short trip — single call
  if (rawCoords.length <= CHUNK_SIZE) {
    return matchChunk(rawCoords);
  }

  // Long trip — sample first then try single call; if that fails, chunk
  const sampled = sample(rawCoords, CHUNK_SIZE);
  const single  = await matchChunk(sampled);
  if (single) return single;

  // Chunk approach: split raw coords into overlapping segments
  const chunks = [];
  for (let i = 0; i < rawCoords.length; i += (CHUNK_SIZE - OVERLAP)) {
    chunks.push(rawCoords.slice(i, Math.min(i + CHUNK_SIZE, rawCoords.length)));
    if (i + CHUNK_SIZE >= rawCoords.length) break;
  }

  // Run chunks sequentially to avoid rate-limit
  const results = [];
  for (const chunk of chunks) {
    results.push(await matchChunk(chunk));
    await new Promise(r => setTimeout(r, 150)); // small delay
  }

  // Merge, skip overlap points from subsequent chunks
  const merged = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) continue;
    merged.push(...(i === 0 ? results[i] : results[i].slice(OVERLAP)));
  }
  return merged.length >= 2 ? merged : null;
}

// ── Planned Route ────────────────────────────────────────────────────────────

/**
 * getPlannedRoute — Computes the optimal driving route via intermediate waypoints.
 * Uses 8 evenly-spaced GPS points as route hints so the planned path follows roads
 * through the same general area (not just a straight start→end line).
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function getPlannedRoute(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Use up to 8 waypoints: start, ~6 intermediates, end
  const waypoints = sample(rawCoords, Math.min(rawCoords.length, 8));

  const url = `${OSRM_BASE}/route/v1/driving/${coordStr(waypoints)}`
    + `?overview=full&geometries=geojson`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) return null;
    return data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('[OSRM route]', err.message);
    return null;
  }
}
