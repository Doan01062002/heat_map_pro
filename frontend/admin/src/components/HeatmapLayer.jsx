import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Pure smooth gradient heatmap using MapLibre native heatmap type.
 * NO trajectory lines — only the density gradient following road patterns.
 *
 * When a trip is selected, shows:
 *  - Actual GPS path (orange line)
 *  - Planned straight-line route (dashed blue)
 *  - GPS points along the route
 */
export default function HeatmapLayer({ map, points = [], selectedTrip = null }) {
  const initialized = useRef(false);
  const tripLayersAdded = useRef(false);

  // ── Main heatmap effect ────────────────────────────────────────────────────
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

      // Smooth heatmap — full zoom range
      map.addLayer({
        id: 'hm-heat',
        type: 'heatmap',
        source: 'hm-points',
        maxzoom: 18,
        paint: {
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0, 0, 500, 0.15, 5000, 0.4, 50000, 0.75, 200000, 1.0,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            6, 0.5, 9, 1.0, 12, 1.8, 15, 2.8,
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            6, 8, 9, 18, 11, 28, 13, 40, 15, 55, 17, 70,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.08, 'rgba(0,220,100,0.0)',
            0.18, 'rgba(0,220,80,0.6)',
            0.32, 'rgba(100,230,0,0.7)',
            0.48, 'rgba(210,240,0,0.75)',
            0.64, 'rgba(255,190,0,0.82)',
            0.80, 'rgba(255,100,0,0.88)',
            0.92, 'rgba(255,30,0,0.94)',
            1.0,  'rgba(200,0,0,1.0)',
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            8, 0.92, 14, 0.80, 17, 0.65,
          ],
        },
      });

      // Individual dots at high zoom only
      map.addLayer({
        id: 'hm-dots',
        type: 'circle',
        source: 'hm-points',
        minzoom: 15,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 18, 7],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0, '#00ff80', 5000, '#ffff00', 30000, '#ff8800', 100000, '#ff0040',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.4)',
        },
      });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Selected trip overlay ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

    // Remove old trip layers
    const tripLayers = ['trip-planned', 'trip-actual', 'trip-pts', 'trip-start', 'trip-end'];
    const tripSources = ['trip-planned-src', 'trip-actual-src', 'trip-pts-src'];
    tripLayers.forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
    tripSources.forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });
    tripLayersAdded.current = false;

    if (!selectedTrip || !selectedTrip.coords || selectedTrip.coords.length < 2) return;

    const coords = selectedTrip.coords; // [[lng, lat], ...]
    const start = coords[0];
    const end = coords[coords.length - 1];

    // Planned route: straight line origin → destination
    map.addSource('trip-planned-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [start, end] },
          properties: {},
        }],
      },
    });

    // Actual route: full GPS path
    map.addSource('trip-actual-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {},
        }],
      },
    });

    // GPS waypoints
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

    // Planned route — dashed blue
    map.addLayer({
      id: 'trip-planned',
      type: 'line',
      source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#4fc3f7',
        'line-width': 3,
        'line-dasharray': [4, 4],
        'line-opacity': 0.9,
      },
    });

    // Actual GPS route — solid orange/red
    map.addLayer({
      id: 'trip-actual',
      type: 'line',
      source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff6b35',
        'line-width': 4,
        'line-opacity': 0.95,
      },
    });

    // GPS waypoints (small dots)
    map.addLayer({
      id: 'trip-pts',
      type: 'circle',
      source: 'trip-pts-src',
      paint: {
        'circle-radius': 3,
        'circle-color': '#ffffff',
        'circle-opacity': 0.7,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ff6b35',
      },
    });

    // Fly to trip bounds
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, duration: 1200 }
    );

    tripLayersAdded.current = true;
  }, [map, selectedTrip]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      const layers = ['hm-heat', 'hm-dots', 'trip-planned', 'trip-actual', 'trip-pts'];
      const sources = ['hm-points', 'trip-planned-src', 'trip-actual-src', 'trip-pts-src'];
      try {
        layers.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        sources.forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      } catch (_) {}
      initialized.current = false;
    };
  }, [map]);

  return null;
}
