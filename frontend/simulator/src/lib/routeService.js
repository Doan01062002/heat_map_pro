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

// Match-snap user drawn waypoints to actual road network via OSRM Match API
export async function matchRouteOSRM(waypoints) {
  if (!waypoints || waypoints.length < 2) return waypoints || [];

  const osrmBase = import.meta.env.VITE_OSRM_URL || 'https://router.project-osrm.org';
  const samplePts = waypoints.length > 80 
    ? waypoints.filter((_, idx) => idx % Math.ceil(waypoints.length / 80) === 0)
    : waypoints;

  const coordsStr = samplePts.map(w => `${w[0]},${w[1]}`).join(';');
  const url = `${osrmBase}/match/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.matchings && data.matchings.length > 0) {
        return data.matchings.flatMap(m => m.geometry.coordinates);
      }
    }
  } catch (err) {
    console.warn('[OSRM Match Error]', err);
  }
  return waypoints;
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
