import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Three visualization modes:
 *
 * 1. Background heatmap: smaller radius, tighter kernel → follows road density
 * 2. Road-snapped actual route: orange line (OSRM map-matched GPS)
 * 3. Planned route: blue dashed line (OSRM optimal route)
 */
export default function HeatmapLayer({
  map,
  points = [],
  selectedTrip = null,
}) {
  const initialized = useRef(false);

  // ── Heatmap layer ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || points.length === 0) return;

    const maxDev = points.reduce((m, p) => Math.max(m, p.deviation || 0), 1);

    const features = points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        deviation: p.deviation || 0,
        weight: Math.min((p.deviation || 0) / maxDev, 1),
      },
    }));

    const geojson = { type: 'FeatureCollection', features };

    if (!initialized.current) {
      map.addSource('hm-points', { type: 'geojson', data: geojson });

      map.addLayer({
        id: 'hm-heat',
        type: 'heatmap',
        source: 'hm-points',
        maxzoom: 18,
        paint: {
          // Weight by deviation distance
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0, 0, 1000, 0.1, 10000, 0.35, 80000, 0.7, 200000, 1.0,
          ],
          // Zoom-dependent intensity — keep relatively subtle
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            6, 0.3,
            9, 0.5,
            12, 0.9,
            14, 1.2,
            17, 1.5,
          ],
          // ★ KEY FIX: much smaller radius → tighter blobs that follow roads
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            6,  4,
            8,  6,
            10, 10,
            12, 14,
            14, 20,
            16, 28,
            18, 38,
          ],
          // Color ramp: transparent → teal → green → yellow → orange → red
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.05, 'rgba(0,180,120,0)',
            0.15, 'rgba(0,220,80,0.65)',
            0.30, 'rgba(100,230,0,0.72)',
            0.50, 'rgba(220,240,0,0.78)',
            0.68, 'rgba(255,180,0,0.84)',
            0.84, 'rgba(255,80,0,0.90)',
            0.95, 'rgba(255,20,0,0.95)',
            1.0,  'rgba(200,0,0,1.0)',
          ],
          // Slightly transparent so roads are visible underneath
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            7,  0.88,
            12, 0.80,
            15, 0.70,
            18, 0.60,
          ],
        },
      });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Trip route overlay ────────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

    // Remove previous trip layers/sources
    ['trip-planned', 'trip-actual', 'trip-pts'].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
    });
    ['trip-planned-src', 'trip-actual-src', 'trip-pts-src'].forEach(id => {
      try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
    });

    if (!selectedTrip) return;

    const {
      coords,          // raw GPS [lng,lat][]
      matchedRoute,    // OSRM map-matched [lng,lat][] (null while loading)
      plannedRoute,    // OSRM planned route [lng,lat][] (null while loading)
    } = selectedTrip;

    if (!coords || coords.length < 2) return;

    const actualCoords  = matchedRoute || coords;    // fallback to raw if not yet matched
    const plannedCoords = plannedRoute || [coords[0], coords[coords.length - 1]]; // fallback straight line

    // Sources
    map.addSource('trip-planned-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: plannedCoords }, properties: {} }],
      },
    });

    map.addSource('trip-actual-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: actualCoords }, properties: {} }],
      },
    });

    map.addSource('trip-pts-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: coords.map((c, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: c },
          properties: { idx: i },
        })),
      },
    });

    // Planned route — dashed blue, behind actual
    map.addLayer({
      id: 'trip-planned',
      type: 'line',
      source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#29b6f6',
        'line-width': 4,
        'line-dasharray': [5, 4],
        'line-opacity': 0.95,
        'line-gap-width': 0,
      },
    });

    // Actual GPS route — solid orange (road-snapped if OSRM returned data)
    map.addLayer({
      id: 'trip-actual',
      type: 'line',
      source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff6b35',
        'line-width': 3,
        'line-opacity': 0.92,
      },
    });

    // Raw GPS waypoints (small dots, only at high zoom)
    map.addLayer({
      id: 'trip-pts',
      type: 'circle',
      source: 'trip-pts-src',
      minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5],
        'circle-color': '#ffffff',
        'circle-opacity': 0.6,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ff6b35',
      },
    });

    // Fly to route bounds
    const allCoords = [...actualCoords, ...plannedCoords];
    const lngs = allCoords.map(c => c[0]);
    const lats = allCoords.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, duration: 1200, maxZoom: 15 }
    );
  }, [map, selectedTrip]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      ['hm-heat', 'trip-planned', 'trip-actual', 'trip-pts'].forEach(id => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
      });
      ['hm-points', 'trip-planned-src', 'trip-actual-src', 'trip-pts-src'].forEach(id => {
        try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
      });
      initialized.current = false;
    };
  }, [map]);

  return null;
}
