/**
 * osrmRouting.js — OSRM Public API utilities.
 *
 * Road-Following Route: Snaps GPS traces to road network via /route API
 * Planned Route: Optimal driving route via intermediate waypoints
 * Nearest: Snap single point to nearest road
 *
 * NOTE: We use /route instead of /match because:
 *   - /match requires dense GPS (every 1-5s) with small radius
 *   - Porto taxi data has sparse GPS (15s intervals) causing /match to fail with "TooBig"
 *   - /route connects waypoints via the road network, works with any spacing
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
  } catch (err) {
    clearTimeout(t);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ── Road-Following Route (replaces /match) ───────────────────────────────────

/**
 * routeChunk — Route through up to 100 waypoints via OSRM /route API.
 * Returns the road-following geometry coordinates or null.
 *
 * OSRM /route limit: max 100 waypoints per request.
 */
async function routeChunk(coords) {
  if (coords.length < 2) return null;

  // OSRM /route has a limit of ~100 waypoints
  const limited = coords.length > 100 ? sample(coords, 100) : coords;

  const url = `${OSRM_BASE}/route/v1/driving/${coordStr(limited)}`
    + `?overview=full&geometries=geojson&continue_straight=false`;

  try {
    const data = await fetchWithTimeout(url);
    if (data.code !== 'Ok' || !data.routes?.length) {
      console.warn('[OSRM route chunk] failed:', data.code, data.message);
      return null;
    }
    return data.routes[0].geometry.coordinates;
  } catch (err) {
    console.warn('[OSRM route chunk]', err.message);
    return null;
  }
}

/**
 * matchTripToRoads — Snaps a full GPS trace to the road network.
 *
 * Uses OSRM /route API (NOT /match) because Porto taxi GPS is too sparse for /match.
 * Strategy:
 *   - ≤ 100 points: single /route call with all points as waypoints
 *   - 100-500 points: sample to 80 waypoints, single call
 *   - > 500 points: chunk into overlapping segments of 60 waypoints each
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}  road-following coordinates
 */
export async function matchTripToRoads(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Short trip — direct route with all points
  if (rawCoords.length <= 100) {
    return routeChunk(rawCoords);
  }

  // Medium trip — sample to 80 waypoints
  if (rawCoords.length <= 500) {
    return routeChunk(sample(rawCoords, 80));
  }

  // Long trip — chunk into overlapping segments
  const WAYPOINTS_PER_CHUNK = 60;
  const OVERLAP = 5; // 5-point overlap for continuity
  const sampled = sample(rawCoords, 200); // sample to manageable size first

  const chunks = [];
  for (let i = 0; i < sampled.length; i += (WAYPOINTS_PER_CHUNK - OVERLAP)) {
    const end = Math.min(i + WAYPOINTS_PER_CHUNK, sampled.length);
    chunks.push(sampled.slice(i, end));
    if (end >= sampled.length) break;
  }

  // Sequential to respect rate limits
  const results = [];
  for (const chunk of chunks) {
    results.push(await routeChunk(chunk));
    await new Promise(r => setTimeout(r, 300)); // respect rate limit
  }

  // Merge route segments
  const merged = [];
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) continue;
    if (i === 0) {
      merged.push(...results[i]);
    } else {
      // Skip some initial points to avoid duplicate geometry at overlap
      const skip = Math.min(10, Math.floor(results[i].length * 0.1));
      merged.push(...results[i].slice(skip));
    }
  }
  return merged.length >= 2 ? merged : null;
}

// ── Planned Route ────────────────────────────────────────────────────────────

/**
 * getPlannedRoute — Computes the optimal driving route via intermediate waypoints.
 * Uses up to 12 evenly-spaced GPS points as route hints so the planned path
 * follows roads through the same general corridor.
 *
 * @param {Array<[number,number]>} rawCoords  [lng,lat][]
 * @returns {Promise<Array<[number,number]>|null>}
 */
export async function getPlannedRoute(rawCoords) {
  if (!rawCoords || rawCoords.length < 2) return null;

  // Use up to 12 waypoints: start, ~10 intermediates, end
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

/**
 * snapPointToRoad — Snaps a single [lng, lat] to the nearest road.
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
 * snapPointsBatch — Snap array of [lng,lat] coords to roads in batches.
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
