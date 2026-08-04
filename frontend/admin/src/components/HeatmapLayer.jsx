import { useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

/**
 * HeatmapLayer:
 * 1. Smooth heatmap gradient (all zooms)
 * 2. Trajectory lines at zoom ≥ 11 (road-following colored segments)
 * 3. GPS dots at zoom ≥ 15 (snapped near-road via OSRM nearest)
 * 4. Click on heatmap/road → Vietnamese stats popup via /api/road-stats
 * 5. Selected trip: planned route (blue dashed) + actual route (orange)
 */
export default function HeatmapLayer({ map, points = [], trajectories = [], selectedTrip = null }) {
  const initialized = useRef(false);
  const trajLoaded   = useRef(false);
  const clickHandler = useRef(null);

  // ── Heatmap + click handler ───────────────────────────────────────────────
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

      // ── Heatmap layer (no maxzoom) ──
      map.addLayer({
        id: 'hm-heat',
        type: 'heatmap',
        source: 'hm-points',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'deviation'],
            0, 0, 1000, 0.08, 10000, 0.3, 80000, 0.65, 200000, 1.0],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'],
            4, 0.2, 7, 0.4, 9, 0.6, 11, 0.9, 13, 1.2, 16, 1.6],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
            4, 3, 6, 5, 8, 7, 10, 11, 12, 16, 14, 22, 16, 30, 18, 40],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.05, 'rgba(0,200,120,0)',
            0.15, 'rgba(0,220,80,0.6)',
            0.30, 'rgba(100,230,0,0.7)',
            0.50, 'rgba(220,240,0,0.76)',
            0.68, 'rgba(255,170,0,0.82)',
            0.84, 'rgba(255,70,0,0.90)',
            0.95, 'rgba(255,15,0,0.96)',
            1.0, 'rgba(200,0,0,1.0)',
          ],
          'heatmap-opacity': 0.82,
        },
      });

      // ── Invisible layer for heatmap click ──
      map.addLayer({
        id: 'hm-hover',
        type: 'circle',
        source: 'hm-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 12, 18, 18, 26],
          'circle-color': 'transparent',
          'circle-opacity': 0,
        },
      });

      // ── GPS dots at high zoom ──
      map.addLayer({
        id: 'hm-dots',
        type: 'circle',
        source: 'hm-points',
        minzoom: 15,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 18, 6],
          'circle-color': ['interpolate', ['linear'], ['get', 'deviation'],
            0, '#00ff80', 5000, '#ffff00', 30000, '#ff8800', 100000, '#ff0040'],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // ── General map click → Vietnamese stats popup ──
      const onMapClick = async (e) => {
        // Don't show if clicking on a trip route layer
        const tripLayers = ['trip-actual', 'trip-planned'];
        for (const layer of tripLayers) {
          if (map.getLayer(layer)) {
            const f = map.queryRenderedFeatures(e.point, { layers: [layer] });
            if (f.length > 0) return; // let trip layer handler handle it
          }
        }

        const { lng, lat } = e.lngLat;
        const zoom = map.getZoom();
        // Radius scaled with zoom: closer = smaller query area
        const radius = zoom < 10 ? 300 : zoom < 12 ? 200 : zoom < 14 ? 150 : 100;

        // Show loading popup immediately
        const loadingPopup = new window.maplibregl.Popup({ offset: 12, maxWidth: '260px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-family:Inter,system-ui,sans-serif;color:#333;font-size:13px">
              <div style="font-weight:700;margin-bottom:6px">📍 Đang tải thống kê…</div>
              <div style="color:#888;font-size:11px">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            </div>
          `)
          .addTo(map);

        try {
          const res = await fetch(`${API_URL}/api/road-stats?lat=${lat}&lng=${lng}&radius=${radius}`);
          const d = await res.json();

          loadingPopup.remove();

          if (d.unique_trips === 0) {
            new window.maplibregl.Popup({ offset: 12, maxWidth: '240px' })
              .setLngLat(e.lngLat)
              .setHTML(`
                <div style="font-family:Inter,system-ui,sans-serif;color:#333;font-size:13px;line-height:1.7">
                  <div style="font-weight:700;margin-bottom:4px">📍 Khu vực này</div>
                  <div style="color:#888">Không có dữ liệu trong bán kính ${radius}m</div>
                  <div style="color:#bbb;font-size:10px;margin-top:4px">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
                </div>
              `)
              .addTo(map);
            return;
          }

          const devKm = d.avg_deviation >= 1000
            ? `${(d.avg_deviation / 1000).toFixed(1)} km`
            : `${Math.round(d.avg_deviation)} m`;
          const maxKm = d.max_deviation >= 1000
            ? `${(d.max_deviation / 1000).toFixed(1)} km`
            : `${Math.round(d.max_deviation)} m`;
          const ratio = d.avoid_ratio.toFixed(1);
          const intensityColor = d.avoid_ratio < 20 ? '#00e664'
            : d.avoid_ratio < 50 ? '#ccee00'
            : d.avoid_ratio < 75 ? '#ff8800' : '#ff2244';

          const barWidth = Math.min(100, Math.round(d.avoid_ratio));

          new window.maplibregl.Popup({ offset: 12, maxWidth: '270px', closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:Inter,system-ui,sans-serif;font-size:12.5px;color:#111;line-height:1.8">
                <div style="font-weight:800;font-size:14px;margin-bottom:10px;color:#1a237e">
                  🛣️ Thống kê đoạn đường
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-bottom:10px">
                  <div>
                    <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Tổng lượt xe</div>
                    <div style="font-weight:700;font-size:16px;color:#1565c0">${d.unique_trips}</div>
                  </div>
                  <div>
                    <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Tài xế khác nhau</div>
                    <div style="font-weight:700;font-size:16px;color:#6a1b9a">${d.unique_drivers}</div>
                  </div>
                  <div>
                    <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Xe đi đúng đường</div>
                    <div style="font-weight:700;font-size:16px;color:#2e7d32">${d.normal_trips}</div>
                  </div>
                  <div>
                    <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Xe né tránh</div>
                    <div style="font-weight:700;font-size:16px;color:#c62828">${d.high_dev_trips}</div>
                  </div>
                </div>

                <div style="margin-bottom:8px">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px">
                    <span style="color:#555;font-size:11px">Tỷ lệ né tránh</span>
                    <b style="color:${intensityColor}">${ratio}%</b>
                  </div>
                  <div style="background:#eee;border-radius:4px;height:7px;overflow:hidden">
                    <div style="width:${barWidth}%;height:100%;background:linear-gradient(90deg,${intensityColor},${intensityColor}99);border-radius:4px;transition:width .4s"></div>
                  </div>
                </div>

                <div style="border-top:1px solid #eee;padding-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
                  <div>
                    <div style="color:#888;font-size:10px">Độ lệch TB</div>
                    <div style="font-weight:600;color:#e65100">${devKm}</div>
                  </div>
                  <div>
                    <div style="color:#888;font-size:10px">Độ lệch max</div>
                    <div style="font-weight:600;color:#b71c1c">${maxKm}</div>
                  </div>
                </div>

                <div style="margin-top:6px;color:#bbb;font-size:10px">
                  📌 ${lat.toFixed(5)}, ${lng.toFixed(5)} · bán kính ${radius}m
                </div>
              </div>
            `)
            .addTo(map);
        } catch (err) {
          loadingPopup.remove();
          console.warn('[road-stats] fetch failed:', err);
        }
      };

      clickHandler.current = onMapClick;
      map.on('click', onMapClick);

      map.on('mouseenter', 'hm-hover', () => { map.getCanvas().style.cursor = 'crosshair'; });
      map.on('mouseleave', 'hm-hover', () => { map.getCanvas().style.cursor = ''; });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Trajectory lines (road-following, visible at zoom ≥ 11) ──────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

    // Remove old trajectory layers/source
    ['traj-bg', 'traj-line'].forEach(id => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {}
    });
    try { if (map.getSource('trajectories')) map.removeSource('trajectories'); } catch (_) {}
    trajLoaded.current = false;

    if (!trajectories || trajectories.length === 0) return;

    // Build GeoJSON from trajectory feature list
    const gj = {
      type: 'FeatureCollection',
      features: trajectories.map(t => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: t.coords },
        properties: {
          avg_deviation: t.avg_deviation || 0,
          driver_id: t.driver_id,
          trip_id: t.trip_id,
        },
      })),
    };

    map.addSource('trajectories', { type: 'geojson', data: gj });

    // Casing (dark outline) for readability
    map.addLayer({
      id: 'traj-bg',
      type: 'line',
      source: 'trajectories',
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#000',
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4],
        'line-opacity': 0.35,
      },
    });

    // Colored line by deviation level
    map.addLayer({
      id: 'traj-line',
      type: 'line',
      source: 'trajectories',
      minzoom: 11,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'interpolate', ['linear'], ['get', 'avg_deviation'],
          0, '#00e064', 2000, '#aadd00', 10000, '#ff8800', 50000, '#ff2244',
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 13, 2, 15, 3],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 13, 0.7, 15, 0.85],
      },
    });

    trajLoaded.current = true;
  }, [map, trajectories]);

  // ── Selected trip route overlay ───────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

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
          properties: { idx: i },
        })),
      },
    });

    map.addLayer({ id: 'trip-planned-case', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.25 },
    });
    map.addLayer({ id: 'trip-planned', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#29b6f6', 'line-width': 4, 'line-dasharray': [5, 4], 'line-opacity': 0.95 },
    });
    map.addLayer({ id: 'trip-actual-case', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.4 },
    });
    map.addLayer({ id: 'trip-actual', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.95 },
    });
    map.addLayer({ id: 'trip-pts', type: 'circle', source: 'trip-pts-src', minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 5],
        'circle-color': '#fff', 'circle-opacity': 0.7,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#ff6b35',
      },
    });

    map.on('mouseenter', 'trip-actual',  () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-actual',  () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'trip-planned', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-planned', () => { map.getCanvas().style.cursor = ''; });

    const all = [...actualCoords, ...plannedCoords];
    const lngs = all.map(c => c[0]), lats = all.map(c => c[1]);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, duration: 1200, maxZoom: 14 }
    );
  }, [map, selectedTrip]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      if (clickHandler.current) map.off('click', clickHandler.current);
      ['hm-heat','hm-hover','hm-dots','traj-bg','traj-line',
        'trip-planned-case','trip-planned','trip-actual-case','trip-actual','trip-pts',
      ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
      ['hm-points','trajectories','trip-planned-src','trip-actual-src','trip-pts-src',
      ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });
      initialized.current = false;
    };
  }, [map]);

  return null;
}
