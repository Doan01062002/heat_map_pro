/**
 * osrmRouting.js — OSRM Public API utilities.
 *
 * Map Matching: Snaps GPS traces to road network (chunked for long trips)
 * Routing: Planned route via intermediate waypoints (not just start→end)
 * Nearest: Snap single point to nearest road
 */

const OSRM_BASE = 'https://router.project-osrm.org';
const TIMEOUT_MS = 15000;

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
  return coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
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
 * matchChunk — Match a single chunk of coordinates to the road network.
 * OSRM /match has a limit of 100 coordinates per request.
 * Uses radius=50m (good for typical GPS error of taxi data).
 * Returns matched coordinates or null.
 */
async function matchChunk(coords) {
  if (coords.length < 2) return null;

  // Limit to 100 points per OSRM constraint
  const limited = coords.length > 100 ? sample(coords, 100) : coords;

  // 50m radius covers typical GPS drift for urban taxi data
  const radii = limited.map(() => '50').join(';');
  const url = `${OSRM_BASE}/match/v1/driving/${coordStr(limited)}`
    + `?overview=full&geometries=geojson&gaps=ignore&radiuses=${radii}`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.matchings?.length) {
      console.warn('[OSRM match] no match, code:', data.code, data.message);
      return null;
    }
    // Combine all matching segments into one coordinate array
    return data.matchings.flatMap(m => m.geometry.coordinates);
  } catch (err) {
    console.warn('[OSRM match chunk]', err.message);
    return null;
  }
}

/**
 * matchTripToRoads — Snaps full GPS trace to roads.
 * Automatically chunks long trips into overlapping segments.
 * Strategy:
 *   - ≤ 100 points: single call
 *   - 100-500 points: sample to 100 then single call
 *   - > 500 points: chunk into 80-point segments with 10-point overlap
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Short trip — single call
  if (rawCoords.length <= 100) {
    return matchChunk(rawCoords);
  }

  // Medium trip — sample down to 100 points
  if (rawCoords.length <= 500) {
    const sampled = sample(rawCoords, 100);
    return matchChunk(sampled);
  }

  // Long trip — chunk approach
  const CHUNK_SIZE = 80;
  const OVERLAP    = 10;
  const chunks = [];
  for (let i = 0; i < rawCoords.length; i += (CHUNK_SIZE - OVERLAP)) {
    const end = Math.min(i + CHUNK_SIZE, rawCoords.length);
    chunks.push(rawCoords.slice(i, end));
    if (end >= rawCoords.length) break;
  }

  // Run chunks sequentially to avoid rate-limit
  const results = [];
  for (const chunk of chunks) {
    results.push(await matchChunk(chunk));
    await new Promise(r => setTimeout(r, 200));
  }

  // Merge, skip overlap from subsequent chunks
  const merged = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) continue;
    if (i === 0) {
      merged.push(...results[i]);
    } else {
      // Skip first few points (overlap region) to avoid duplicates
      merged.push(...results[i].slice(Math.min(20, results[i].length)));
    }
  }
  return merged.length >= 2 ? merged : null;
}

// ── Planned Route ────────────────────────────────────────────────────────────

/**
 * getPlannedRoute — Computes the optimal driving route via intermediate waypoints.
 * Uses up to 10 evenly-spaced GPS points as route hints so the planned path
 * follows roads through the same general corridor.
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function getPlannedRoute(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Use up to 10 waypoints: start, ~8 intermediates, end
  const waypoints = sample(rawCoords, Math.min(rawCoords.length, 10));

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

// ── Nearest Road Snap ─────────────────────────────────────────────────────────

/**
 * snapPointToRoad — Snaps a single [lng, lat] coordinate to the nearest road.
 * Uses OSRM /nearest/v1/driving endpoint.
 *
 * @param {number} lng
 * @param {number} lat
 * @returns {Promise<[number,number]|null>}  snapped [lng,lat] or null on failure
 */
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

/**
 * snapPointsBatch — Snap an array of [lng,lat] coords to roads in batches.
 * Limits concurrency to avoid rate-limiting on OSRM public server.
 *
 * @param {Array<[number,number]>} coords
 * @param {number} concurrency  max parallel requests (default 6)
 * @returns {Promise<Array<[number,number]|null>>}
 */
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
