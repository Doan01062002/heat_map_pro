import { useEffect, useRef } from 'react';

/**
 * HeatmapLayer — Visualization layers:
 * 1. Smooth heatmap (all zoom levels, no maxzoom cutoff)
 * 2. Trip actual route (OSRM map-matched orange line)
 * 3. Trip planned route (OSRM optimal blue dashed line)
 * 4. Click popups on heatmap points + route segments
 */
export default function HeatmapLayer({ map, points = [], selectedTrip = null }) {
  const initialized = useRef(false);

  // ── Heatmap ───────────────────────────────────────────────────────────────
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

      // ── Smooth gradient heatmap (NO maxzoom — visible at all zoom levels) ──
      map.addLayer({
        id: 'hm-heat',
        type: 'heatmap',
        source: 'hm-points',
        // No maxzoom: heatmap always visible
        paint: {
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0, 0, 1000, 0.08, 10000, 0.3, 80000, 0.65, 200000, 1.0,
          ],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            4, 0.2, 7, 0.4, 9, 0.6, 11, 0.9, 13, 1.2, 16, 1.6,
          ],
          // Tight radius so blobs follow road corridors, not spill everywhere
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            4,  3,
            6,  5,
            8,  7,
            10, 11,
            12, 16,
            14, 22,
            16, 30,
            18, 40,
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0,    'rgba(0,0,0,0)',
            0.05, 'rgba(0,200,120,0)',
            0.15, 'rgba(0,220,80,0.6)',
            0.30, 'rgba(100,230,0,0.7)',
            0.50, 'rgba(220,240,0,0.76)',
            0.68, 'rgba(255,170,0,0.82)',
            0.84, 'rgba(255,70,0,0.90)',
            0.95, 'rgba(255,15,0,0.96)',
            1.0,  'rgba(200,0,0,1.0)',
          ],
          'heatmap-opacity': 0.82,
        },
      });

      // ── Invisible circle layer for heatmap click detection ──
      map.addLayer({
        id: 'hm-hover',
        type: 'circle',
        source: 'hm-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 12, 16, 18, 24],
          'circle-color':  'transparent',
          'circle-opacity': 0,
        },
      });

      // ── Visible dots at high zoom only ──
      map.addLayer({
        id: 'hm-dots',
        type: 'circle',
        source: 'hm-points',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 6],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'deviation'],
            0, '#00ff80', 5000, '#ffff00', 30000, '#ff8800', 100000, '#ff0040',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.35)',
        },
      });

      // ── Heatmap click popup ──
      map.on('click', 'hm-hover', (e) => {
        if (!e.features?.length) return;
        const p = e.features[0].properties;
        const dev = p.deviation;
        const devFmt = dev >= 1000 ? `${(dev/1000).toFixed(1)} km` : `${Math.round(dev)} m`;
        const intensity = dev < 1000 ? 'Low' : dev < 10000 ? 'Medium' : dev < 50000 ? 'High' : 'Critical';
        const intensityColor = dev < 1000 ? '#00e664' : dev < 10000 ? '#ccee00' : dev < 50000 ? '#ff8800' : '#ff2244';

        new (map._maplibregl || window.maplibregl).Popup({ offset: 12, maxWidth: '230px', closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#1a1a2e;line-height:1.65">
              <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#111">📍 Deviation Point</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="color:#666">Deviation</span>
                <b style="color:${intensityColor}">${devFmt}</b>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="color:#666">Intensity</span>
                <span style="background:${intensityColor}22;color:${intensityColor};padding:1px 8px;border-radius:10px;font-weight:600;font-size:11px">${intensity}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#666">Lng</span>
                <code style="font-size:11px;color:#444">${e.lngLat.lng.toFixed(5)}</code>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:#666">Lat</span>
                <code style="font-size:11px;color:#444">${e.lngLat.lat.toFixed(5)}</code>
              </div>
            </div>
          `)
          .addTo(map);
      });

      map.on('mouseenter', 'hm-hover', () => { map.getCanvas().style.cursor = 'crosshair'; });
      map.on('mouseleave', 'hm-hover', () => { map.getCanvas().style.cursor = ''; });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Selected trip route layers ─────────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

    // Remove old trip layers
    ['trip-planned-case', 'trip-planned', 'trip-actual-case', 'trip-actual', 'trip-pts'].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
    });
    ['trip-planned-src', 'trip-actual-src', 'trip-pts-src'].forEach(id => {
      try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
    });

    if (!selectedTrip) return;

    const { coords, matchedRoute, plannedRoute } = selectedTrip;
    if (!coords || coords.length < 2) return;

    const actualCoords  = matchedRoute || coords;
    const plannedCoords = plannedRoute || [coords[0], coords[coords.length - 1]];

    // Sources
    map.addSource('trip-planned-src', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: plannedCoords }, properties: {} },
    });
    map.addSource('trip-actual-src', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: actualCoords }, properties: {} },
    });
    map.addSource('trip-pts-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: coords.map((c, i) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: c },
          properties: { idx: i, total: coords.length },
        })),
      },
    });

    // Planned route: white casing + blue dashed line
    map.addLayer({ id: 'trip-planned-case', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.3 },
    });
    map.addLayer({ id: 'trip-planned', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#29b6f6', 'line-width': 4, 'line-dasharray': [5, 4], 'line-opacity': 0.95 },
    });

    // Actual route: dark casing + orange line
    map.addLayer({ id: 'trip-actual-case', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000', 'line-width': 6, 'line-opacity': 0.4 },
    });
    map.addLayer({ id: 'trip-actual', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.95 },
    });

    // GPS waypoints
    map.addLayer({ id: 'trip-pts', type: 'circle', source: 'trip-pts-src', minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5],
        'circle-color': '#fff', 'circle-opacity': 0.7,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#ff6b35',
      },
    });

    // ── Click on actual route ──
    map.on('click', 'trip-actual', (e) => {
      const { driver_id, avg_deviation, point_count } = selectedTrip;
      const devKm = (avg_deviation / 1000).toFixed(2);
      const matched = !!selectedTrip.matchedRoute;

      new (map._maplibregl || window.maplibregl).Popup({ offset: 10, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#111;line-height:1.7">
            <div style="font-weight:700;font-size:14px;margin-bottom:8px">🚕 Actual Route</div>
            <div style="display:flex;justify-content:space-between"><span style="color:#666">Driver</span><b>${driver_id}</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#666">GPS Points</span><b>${point_count}</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#666">Avg Deviation</span><b style="color:#ff6b35">${devKm} km</b></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#666">Map Matched</span>
              <span style="color:${matched ? '#00e664' : '#ff8800'}">${matched ? '✓ OSRM' : '⚠ Raw GPS'}</span>
            </div>
            <div style="margin-top:6px;font-size:11px;color:#999">
              ${e.lngLat.lng.toFixed(5)}, ${e.lngLat.lat.toFixed(5)}
            </div>
          </div>
        `)
        .addTo(map);
    });

    // ── Click on planned route ──
    map.on('click', 'trip-planned', (e) => {
      const planned = !!selectedTrip.plannedRoute;
      new (map._maplibregl || window.maplibregl).Popup({ offset: 10, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#111;line-height:1.7">
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;color:#29b6f6">📘 Planned Route</div>
            <div style="color:#555;font-size:12px;margin-bottom:6px">
              ${planned ? 'OSRM optimal route via intermediate waypoints' : 'Fallback: straight origin→destination'}
            </div>
            <div style="display:flex;justify-content:space-between"><span style="color:#666">Status</span>
              <span style="color:${planned ? '#00e664' : '#ff8800'}">${planned ? '✓ Road-matched' : '⚠ Straight line'}</span>
            </div>
            <div style="margin-top:6px;font-size:11px;color:#999">
              ${e.lngLat.lng.toFixed(5)}, ${e.lngLat.lat.toFixed(5)}
            </div>
          </div>
        `)
        .addTo(map);
    });

    map.on('mouseenter', 'trip-actual',  () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-actual',  () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'trip-planned', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-planned', () => { map.getCanvas().style.cursor = ''; });

    // Fly to bounds
    const all = [...actualCoords, ...plannedCoords];
    const lngs = all.map(c => c[0]), lats = all.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, duration: 1200, maxZoom: 14 }
    );
  }, [map, selectedTrip]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      ['hm-heat','hm-hover','hm-dots','trip-planned-case','trip-planned','trip-actual-case','trip-actual','trip-pts'].forEach(id => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
      });
      ['hm-points','trip-planned-src','trip-actual-src','trip-pts-src'].forEach(id => {
        try { if (map.getSource(id)) map.removeSource(id); } catch (_) {}
      });
      initialized.current = false;
    };
  }, [map]);

  return null;
}
