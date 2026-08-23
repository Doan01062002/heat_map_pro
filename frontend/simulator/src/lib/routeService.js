/**
 * routeService.js — Geocoding & OSRM Routing Service for Driver Simulator.
 * Provides location autocomplete via Nominatim / Photon API and OSRM driving routes.
 */

// Search locations with autocomplete using Nominatim / Photon
export async function searchLocations(query, focusCenter = [106.660172, 10.762622]) {
  if (!query || query.trim().length < 2) return [];

  const trimmed = query.trim();
  try {
    // Try Photon API first (Fast & supports autocomplete)
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&lon=${focusCenter[0]}&lat=${focusCenter[1]}&limit=5`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        return data.features.map(f => {
          const p = f.properties;
          const name = [p.name, p.street, p.suburb, p.city || p.county || p.state, p.country]
            .filter(Boolean)
            .join(', ');
          return {
            id: `${f.geometry.coordinates.join(',')}-${p.osm_id || Math.random()}`,
            label: name || p.name || trimmed,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          };
        });
      }
    }
  } catch (_) {}

  // Fallback to OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&addressdetails=1&limit=5`;
    const nomRes = await fetch(nomUrl, {
      headers: { 'User-Agent': 'HeatmapDriverSimulator/1.0' },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      return nomData.map(item => ({
        id: item.place_id,
        label: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
      }));
    }
  } catch (_) {}

  return [];
}

// Fetch driving route geometry from OSRM
export async function fetchOSRMRoute(origin, destination) {
  // origin: [lng, lat], destination: [lng, lat]
  const osrmBase = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';
  const url = `${osrmBase}/route/v1/driving/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM route request failed');
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      const r = data.routes[0];
      return {
        coordinates: r.geometry.coordinates, // Array of [lng, lat]
        distanceKm: (r.distance / 1000).toFixed(2),
        durationMin: Math.round(r.duration / 60),
      };
    }
  } catch (err) {
    console.warn('[OSRM Fetch Error] Falling back to straight-line route:', err);
  }

  // Fallback interpolation if OSRM is unreachable
  const coords = interpolateLine(origin, destination, 30);
  const dist = haversineDistance(origin, destination);
  return {
    coordinates: coords,
    distanceKm: (dist / 1000).toFixed(2),
    durationMin: Math.round((dist / 1000) * 2.5),
  };
}

// Match-snap user drawn waypoints to actual road network via OSRM Match API.
// Uses chunking (≤10 pts per request per public server limit), radiuses=40m,
// and synthetic timestamps so the HMM algorithm works correctly.
export async function matchRouteOSRM(waypoints) {
  if (!waypoints || waypoints.length < 2) return waypoints || [];

  const osrmBase = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';

  // Sample to ≤100 points while ALWAYS keeping first and last
  let pts = waypoints;
  if (pts.length > 100) {
    const step = (pts.length - 1) / 98;
    const sampled = [pts[0]];
    for (let i = 1; i < 99; i++) sampled.push(pts[Math.round(i * step)]);
    sampled.push(pts[pts.length - 1]);
    pts = sampled;
  }

  // Snap first & last point to nearest road (hand-drawn endpoints are rarely exact)
  async function snapNearest(coord) {
    try {
      const r = await fetch(
        `${osrmBase}/nearest/v1/driving/${coord[0].toFixed(6)},${coord[1].toFixed(6)}?number=1`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        const d = await r.json();
        if (d.code === 'Ok' && d.waypoints?.length) return d.waypoints[0].location;
      }
    } catch (_) { /* ignore */ }
    return coord;
  }
  pts[0] = await snapNearest(pts[0]);
  pts[pts.length - 1] = await snapNearest(pts[pts.length - 1]);

  // Chunk into groups of ≤10 with 2-point overlap (public OSRM server limit)
  const CHUNK = 10, OVERLAP = 2;
  const chunks = [];
  for (let i = 0; i < pts.length; i += CHUNK - OVERLAP) {
    const end = Math.min(i + CHUNK, pts.length);
    chunks.push(pts.slice(i, end));
    if (end >= pts.length) break;
  }

  async function matchChunk(coords) {
    const coordsStr  = coords.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
    // radius=40m: wide enough for hand-drawn points ~10-30m off road
    const radiusStr  = coords.map(() => '40').join(';');
    // synthetic timestamps: 5s per point (short trip interval for simulator)
    const tsStr      = coords.map((_, i) => i * 5).join(';');
    const url = `${osrmBase}/match/v1/driving/${coordsStr}`
      + `?overview=full&geometries=geojson`
      + `&radiuses=${radiusStr}`
      + `&timestamps=${tsStr}`
      + `&tidy=true&gaps=ignore`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.code !== 'Ok' || !data.matchings?.length) return null;
      // Merge all matchings (gaps=ignore may produce multiple)
      return data.matchings.flatMap((m, i) => i === 0 ? m.geometry.coordinates : m.geometry.coordinates.slice(1));
    } catch (_) {
      return null;
    }
  }

  // Fallback: simple route between two endpoints
  async function routePair(a, b) {
    try {
      const url = `${osrmBase}/route/v1/driving/${a[0].toFixed(6)},${a[1].toFixed(6)};${b[0].toFixed(6)},${b[1].toFixed(6)}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();
      return data.code === 'Ok' ? data.routes[0].geometry.coordinates : null;
    } catch (_) { return null; }
  }

  const segments = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const matched = await matchChunk(chunks[ci]);
    if (matched && matched.length >= 2) {
      segments.push(matched);
    } else {
      // fallback: just route start→end of this chunk
      const fb = await routePair(chunks[ci][0], chunks[ci][chunks[ci].length - 1]);
      if (fb) segments.push(fb);
    }
    // Throttle between chunks
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 150));
  }

  if (segments.length === 0) return waypoints;

  // Stitch segments (skip OVERLAP coords at start of each subsequent segment)
  let merged = [...segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const skip = Math.min(OVERLAP, Math.floor(seg.length * 0.15));
    merged.push(...seg.slice(skip));
  }

  // ── Ensure exact start/end anchoring ──────────────────────────────────────
  // OSRM /match snaps GPS to road centerlines; the returned start/end coords
  // may differ slightly from pts[0] / pts[last] (both already road-snapped).
  //
  // Strategy: route a connector from snapStart → merged[0] and from
  // merged[last] → snapEnd, then splice it in. If connector fails or is
  // trivially short (< 10m), just force-replace the endpoint directly.
  const snapStart = pts[0];
  const snapEnd   = pts[pts.length - 1];

  function distM(a, b) {
    const dx = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
    const dy = (b[1] - a[1]) * 111320;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const gapStart = distM(snapStart, merged[0]);
  const gapEnd   = distM(snapEnd, merged[merged.length - 1]);

  if (gapStart > 5) {
    if (gapStart < 80) {
      // Small gap: just prepend the snap point — no extra route needed
      merged = [snapStart, ...merged];
    } else {
      // Larger gap: route a proper connector
      const conn = await routePair(snapStart, merged[0]);
      merged = conn && conn.length >= 2
        ? [...conn.slice(0, -1), ...merged]
        : [snapStart, ...merged];
    }
  }

  if (gapEnd > 5) {
    if (gapEnd < 80) {
      merged = [...merged, snapEnd];
    } else {
      const lastPt = merged[merged.length - 1];
      const conn = await routePair(lastPt, snapEnd);
      merged = conn && conn.length >= 2
        ? [...merged, ...conn.slice(1)]
        : [...merged, snapEnd];
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  return merged.length >= 2 ? merged : waypoints;
}




// Generate actual route with realistic driver deviations/detours
export function generateActualRoute(plannedCoords, deviationPercent = 30) {
  if (!plannedCoords || plannedCoords.length < 2) return plannedCoords || [];

  const devRate = Math.min(100, Math.max(0, deviationPercent)) / 100;
  if (devRate === 0) return [...plannedCoords];

  const result = [];
  const totalPts = plannedCoords.length;

  // Keep first 10% and last 10% strictly on route (Origin & Destination)
  const startOffset = Math.floor(totalPts * 0.1);
  const endOffset = Math.floor(totalPts * 0.9);

  let isDeviating = false;
  let devPointCount = 0;
  let devLatOffset = 0;
  let devLngOffset = 0;

  for (let i = 0; i < totalPts; i++) {
    const [lng, lat] = plannedCoords[i];

    if (i < startOffset || i > endOffset) {
      result.push([lng, lat]);
      isDeviating = false;
      continue;
    }

    // Decide whether to start or continue a deviation detour
    if (!isDeviating && Math.random() < devRate * 0.4) {
      isDeviating = true;
      devPointCount = Math.floor(Math.random() * 8) + 4; // Detour lasts 4 to 12 points
      // Detour offset ~150m to 500m
      const angle = Math.random() * Math.PI * 2;
      const distDeg = (200 + Math.random() * 400) / 111320;
      devLatOffset = Math.sin(angle) * distDeg;
      devLngOffset = Math.cos(angle) * distDeg;
    }

    if (isDeviating && devPointCount > 0) {
      // Smooth bell curve transition for the detour
      const progress = devPointCount / 8;
      const factor = Math.sin(progress * Math.PI);
      result.push([
        lng + devLngOffset * factor,
        lat + devLatOffset * factor,
      ]);
      devPointCount--;
      if (devPointCount === 0) isDeviating = false;
    } else {
      result.push([lng, lat]);
    }
  }

  return result;
}

// Helpers
function interpolateLine(p1, p2, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([
      p1[0] + (p2[0] - p1[0]) * t,
      p1[1] + (p2[1] - p1[1]) * t,
    ]);
  }
  return pts;
}

function haversineDistance(c1, c2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (c2[1] - c1[1]) * rad;
  const dLng = (c2[0] - c1[0]) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(c1[1] * rad) * Math.cos(c2[1] * rad) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
