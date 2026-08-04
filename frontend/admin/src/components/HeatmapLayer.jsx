import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Three-layer road-following heatmap visualization:
 *
 * Layer 1 (zoom 0–16): MapLibre native `heatmap` type
 *   - Uses raw GPS points from real taxi routes → naturally follows roads
 *   - Smooth green → yellow → orange → red gradient
 *   - GPU-accelerated kernel blending for continuous color bands
 *
 * Layer 2 (zoom 11+): `line` layer for trajectory paths
 *   - Each trip rendered as a colored LineString on the road
 *   - Color = avg deviation intensity (green low → red high)
 *   - Creates the "color band along road" effect
 *
 * Layer 3 (zoom 15+): `circle` layer for individual deviation points
 *   - Clickable, shows trip/driver details in popup
 */
export default function HeatmapLayer({ map, points = [], trajectories = null }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (points.length === 0 && !trajectories) return;

    const maxDev = points.reduce((m, p) => Math.max(m, p.deviation || 0), 1);

    // Build GeoJSON for raw points
    const pointFeatures = points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        deviation: p.deviation || 0,
        weight: Math.min((p.deviation || 0) / maxDev, 1),
      },
    }));

    const pointGeoJSON = { type: 'FeatureCollection', features: pointFeatures };

    // Build GeoJSON for trajectories
    const trajGeoJSON = trajectories || { type: 'FeatureCollection', features: [] };

    if (!initialized.current) {
      // ── Source: raw GPS points ──────────────────────────────────────
      map.addSource('hm-points', { type: 'geojson', data: pointGeoJSON });

      // ── Source: trip trajectories ───────────────────────────────────
      map.addSource('hm-trajectories', { type: 'geojson', data: trajGeoJSON });

      // ── Layer 1: Smooth heatmap (zoom 0–15) ─────────────────────────
      map.addLayer({
        id: 'hm-heat',
        type: 'heatmap',
        source: 'hm-points',
        maxzoom: 15,
        paint: {
          // Weight by deviation distance
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0,      0,
            500,    0.2,
            5000,   0.5,
            50000,  0.8,
            200000, 1.0,
          ],
          // Intensity amplification by zoom
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            6,  0.4,
            9,  0.9,
            12, 1.6,
            15, 2.5,
          ],
          // Kernel radius — larger at higher zoom to keep bands connected
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            6,  10,
            9,  20,
            11, 35,
            13, 50,
            15, 70,
          ],
          // Color ramp: transparent → green → yellow → orange → red
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.05, 'rgba(0,204,102,0.0)',
            0.15, 'rgba(0,230,80,0.55)',
            0.30, 'rgba(80,230,0,0.65)',
            0.45, 'rgba(200,240,0,0.72)',
            0.60, 'rgba(255,200,0,0.78)',
            0.75, 'rgba(255,120,0,0.85)',
            0.90, 'rgba(255,40,0,0.92)',
            1.0,  'rgba(220,0,0,1.0)',
          ],
          // Fade slightly at high zoom (trajectories take over)
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            9,  1.0,
            13, 0.85,
            15, 0.6,
          ],
        },
      });

      // ── Layer 2a: Trajectory line casing (dark outline for contrast) ─
      map.addLayer({
        id: 'hm-traj-casing',
        type: 'line',
        source: 'hm-trajectories',
        minzoom: 11,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 4,
            13, 7,
            15, 10,
          ],
          'line-color': 'rgba(0,0,0,0.45)',
          'line-blur': 1,
        },
      });

      // ── Layer 2b: Trajectory colored lines ──────────────────────────
      map.addLayer({
        id: 'hm-traj-line',
        type: 'line',
        source: 'hm-trajectories',
        minzoom: 11,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            11, 2,
            13, 4,
            15, 6,
          ],
          // Color by avg_deviation: green → yellow → red
          'line-color': [
            'interpolate', ['linear'],
            ['get', 'avg_deviation'],
            0,     '#00e664',
            500,   '#44ee00',
            2000,  '#ccee00',
            5000,  '#ffaa00',
            15000, '#ff5500',
            50000, '#ff0022',
          ],
          'line-opacity': [
            'interpolate', ['linear'], ['zoom'],
            11, 0.6,
            13, 0.8,
            15, 0.95,
          ],
        },
      });

      // ── Layer 3: Individual deviation points (high zoom) ─────────────
      map.addLayer({
        id: 'hm-dots',
        type: 'circle',
        source: 'hm-points',
        minzoom: 15,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            15, 3,
            18, 7,
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0,      '#00ff80',
            5000,   '#ffff00',
            30000,  '#ff8800',
            100000, '#ff0040',
          ],
          'circle-opacity': 0.9,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.5)',
        },
      });

      // ── Popup on trajectory click ─────────────────────────────────────
      map.on('click', 'hm-traj-line', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties;
        const devKm = (p.avg_deviation / 1000).toFixed(2);
        new (map._maplibregl || window.maplibregl).Popup({ offset: 8, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:Inter,sans-serif;font-size:13px;color:#222;line-height:1.6">
              <div style="font-weight:700;font-size:14px;margin-bottom:6px">🚕 Trip Trajectory</div>
              <div>Driver: <b>${p.driver_id}</b></div>
              <div>Avg deviation: <b style="color:#e53">${devKm} km</b></div>
              <div>GPS points: <b>${p.point_count}</b></div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'hm-traj-line', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hm-traj-line', () => { map.getCanvas().style.cursor = ''; });

      initialized.current = true;

    } else {
      // Live update — replace source data
      const ptSrc = map.getSource('hm-points');
      if (ptSrc) ptSrc.setData(pointGeoJSON);

      const trSrc = map.getSource('hm-trajectories');
      if (trSrc) trSrc.setData(trajGeoJSON);
    }
  }, [map, points, trajectories]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      const layers = ['hm-heat', 'hm-traj-casing', 'hm-traj-line', 'hm-dots'];
      const sources = ['hm-points', 'hm-trajectories'];
      try {
        layers.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        sources.forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      } catch (_) {}
      initialized.current = false;
    };
  }, [map]);

  return null;
}
