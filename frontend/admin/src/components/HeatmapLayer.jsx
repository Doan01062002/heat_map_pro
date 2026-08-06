import { useEffect, useRef, useMemo } from 'react';
import { latLngToCell, cellToBoundary } from 'h3-js';
import { snapPointsBatch } from '../utils/osrmRouting';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// ── Shared popup helper ───────────────────────────────────────────────────────
/**
 * showRoadStatsPopup — queries /api/road-stats and renders a Vietnamese popup.
 * @param {object} map         MapLibre map instance
 * @param {object} popupLngLat {lng, lat} where to anchor the popup (click point)
 * @param {number} queryLat    lat for DB query (use orig GPS lat for dots)
 * @param {number} queryLng    lng for DB query
 * @param {number} [hintDev]   optional deviation hint (shown before query returns)
 */
async function showRoadStatsPopup(map, popupLngLat, queryLat, queryLng, hintDev) {
  const zoom   = map.getZoom();
  const radius = zoom < 10 ? 300 : zoom < 12 ? 200 : zoom < 14 ? 150 : 100;

  const PopupClass = map._maplibregl?.Popup || window.maplibregl?.Popup;

  const loading = new PopupClass({ offset: 12, maxWidth: '270px' })
    .setLngLat(popupLngLat)
    .setHTML(`
      <div style="font-family:Inter,sans-serif;color:#333;font-size:13px;line-height:1.6">
        <div style="font-weight:700;margin-bottom:4px">📍 Đang tải thống kê…</div>
        ${hintDev != null ? `<div style="color:#e65100;font-size:11px">Độ lệch: ${hintDev >= 1000 ? (hintDev/1000).toFixed(1)+' km' : Math.round(hintDev)+' m'}</div>` : ''}
        <div style="color:#aaa;font-size:11px">${queryLat.toFixed(5)}, ${queryLng.toFixed(5)}</div>
      </div>
    `)
    .addTo(map);

  try {
    const res = await fetch(
      `${API_URL}/api/road-stats?lat=${queryLat}&lng=${queryLng}&radius=${radius}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    loading.remove();

    if (!d.unique_trips) {
      new PopupClass({ offset: 12, maxWidth: '240px' })
        .setLngLat(popupLngLat)
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:13px;color:#333">
            <div style="font-weight:700;margin-bottom:4px">📍 Khu vực này</div>
            <div style="color:#888">Không có dữ liệu trong bán kính ${radius}m.</div>
            <div style="color:#bbb;font-size:10px;margin-top:4px">${queryLat.toFixed(5)}, ${queryLng.toFixed(5)}</div>
          </div>
        `)
        .addTo(map);
      return;
    }

    const fmtDev = v => v >= 1000 ? `${(v/1000).toFixed(1)} km` : `${Math.round(v)} m`;
    const ratio  = d.avoid_ratio.toFixed(1);
    const iColor = d.avoid_ratio < 20 ? '#00b894'
                 : d.avoid_ratio < 50 ? '#fdcb6e'
                 : d.avoid_ratio < 75 ? '#e17055' : '#d63031';
    const barW   = Math.min(100, Math.round(d.avoid_ratio));

    new PopupClass({ offset: 12, maxWidth: '285px', closeButton: true })
      .setLngLat(popupLngLat)
      .setHTML(`
        <div style="font-family:Inter,system-ui,sans-serif;font-size:12.5px;color:#111;line-height:1.85">
          <div style="font-weight:800;font-size:14px;margin-bottom:10px;color:#1a237e">🛣️ Thống kê đoạn đường</div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;margin-bottom:10px">
            <div>
              <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">TỔNG LƯỢT XE</div>
              <div style="font-weight:700;font-size:18px;color:#1565c0">${d.unique_trips}</div>
            </div>
            <div>
              <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">TÀI XẾ</div>
              <div style="font-weight:700;font-size:18px;color:#6a1b9a">${d.unique_drivers}</div>
            </div>
            <div>
              <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">ĐI ĐÚNG ĐƯỜNG</div>
              <div style="font-weight:700;font-size:18px;color:#2e7d32">${d.normal_trips}</div>
            </div>
            <div>
              <div style="color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.5px">NÉ TRÁNH</div>
              <div style="font-weight:700;font-size:18px;color:#c62828">${d.high_dev_trips}</div>
            </div>
          </div>

          <div style="margin-bottom:9px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="color:#555;font-size:11px;font-weight:600">Tỷ lệ né tránh</span>
              <b style="color:${iColor};font-size:13px">${ratio}%</b>
            </div>
            <div style="background:#e8e8e8;border-radius:6px;height:9px;overflow:hidden">
              <div style="width:${barW}%;height:100%;background:linear-gradient(90deg,${iColor}bb,${iColor});border-radius:6px;transition:width .4s"></div>
            </div>
          </div>

          <div style="border-top:1px solid #eee;padding-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div>
              <div style="color:#888;font-size:10px">Độ lệch trung bình</div>
              <div style="font-weight:700;color:#e65100">${fmtDev(d.avg_deviation)}</div>
            </div>
            <div>
              <div style="color:#888;font-size:10px">Độ lệch tối đa</div>
              <div style="font-weight:700;color:#b71c1c">${fmtDev(d.max_deviation)}</div>
            </div>
          </div>

          <div style="margin-top:6px;color:#bbb;font-size:10px">
            📌 ${queryLat.toFixed(5)}, ${queryLng.toFixed(5)} · bán kính ${radius}m
          </div>
        </div>
      `)
      .addTo(map);
  } catch (err) {
    loading.remove();
    console.warn('[road-stats]', err.message);
  }
}

/**
 * show3DH3CellPopup — renders a rich actionable Vietnamese popup for a 3D H3 Hexagon cell.
 */
async function show3DH3CellPopup(map, popupLngLat, cellProps) {
  const PopupClass = map._maplibregl?.Popup || window.maplibregl?.Popup;
  const f = cellProps;

  // Compute exact Geographic Bounding Box [minLat, maxLat, minLng, maxLng] of the H3 Hexagon cell
  let minLat = 0, maxLat = 0, minLng = 0, maxLng = 0;
  let centerLat = popupLngLat?.lat || 0;
  let centerLng = popupLngLat?.lng || 0;

  try {
    if (f && f.h3Index) {
      const boundary = cellToBoundary(f.h3Index, true); // [[lng, lat], ...]
      if (Array.isArray(boundary) && boundary.length > 0) {
        const lats = boundary.map(p => p[1]);
        const lngs = boundary.map(p => p[0]);
        minLat = Math.min(...lats);
        maxLat = Math.max(...lats);
        minLng = Math.min(...lngs);
        maxLng = Math.max(...lngs);
        centerLat = (minLat + maxLat) / 2.0;
        centerLng = (minLng + maxLng) / 2.0;
      }
    }
  } catch (err) {
    console.warn('[show3DH3CellPopup] cellToBoundary failed for', f?.h3Index, err);
  }

  const loading = new PopupClass({ offset: 12, maxWidth: '300px' })
    .setLngLat(popupLngLat)
    .setHTML(`
      <div style="font-family:Inter,sans-serif;color:#333;font-size:13px;line-height:1.6;padding:2px">
        <div style="font-weight:700;margin-bottom:4px;color:#1b5e20">📊 Đang phân tích ô 3D H3…</div>
        <div style="color:#666;font-size:11px">Mã Cell: <code style="background:#e8f5e9;padding:2px 4px;border-radius:4px;color:#2e7d32">${f.h3Index}</code></div>
      </div>
    `)
    .addTo(map);

  try {
    // Query exact H3 Polygon Bounding Box from PostgreSQL backend
    let url = `${API_URL}/api/road-stats`;
    if (minLat > 0 && maxLat > 0) {
      url += `?min_lat=${minLat}&max_lat=${maxLat}&min_lng=${minLng}&max_lng=${maxLng}`;
    } else {
      const cellRadius = f.res === 14 ? 4 : f.res === 13 ? 10 : 25;
      url += `?lat=${centerLat}&lng=${centerLng}&radius=${cellRadius}`;
    }

    const res = await fetch(url);
    let dbStats = null;
    if (res.ok) {
      dbStats = await res.json();
    }
    loading.remove();

    const fmtDev = v => v >= 1000 ? `${(v/1000).toFixed(1)} km` : `${Math.round(v)} m`;

    const totalTrips   = dbStats?.unique_trips ?? 0;
    const drivers      = dbStats?.unique_drivers ?? 0;
    const avoidRatio   = dbStats?.avoid_ratio ?? 0;
    const normalTrips  = dbStats?.normal_trips ?? 0;
    const highDevTrips = dbStats?.high_dev_trips ?? 0;
    const avgDev       = dbStats?.avg_deviation ?? f.avgDev ?? 0;
    const maxDev       = dbStats?.max_deviation ?? f.maxDev ?? 0;

    const riskLabel = avoidRatio > 50 ? '🔴 Rủi ro Bẻ lái Cao' : avoidRatio > 20 ? '🟡 Cảnh báo Né tránh' : '🟢 An toàn (Đúng tuyến)';
    const riskBg    = avoidRatio > 50 ? '#ffebee' : avoidRatio > 20 ? '#fff8e1' : '#e8f5e9';
    const riskColor = avoidRatio > 50 ? '#c62828' : avoidRatio > 20 ? '#f57f17' : '#2e7d32';

    new PopupClass({ offset: 12, maxWidth: '315px', closeButton: true })
      .setLngLat(popupLngLat)
      .setHTML(`
        <div style="font-family:Inter,system-ui,sans-serif;font-size:12px;color:#111;line-height:1.75">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:800;font-size:13.5px;color:#1b5e20">
              🛑 Ô 3D H3 (Res ${f.res || 14} · ${f.res === 12 ? '~25m' : f.res === 13 ? '~9m' : '~3m'})
            </div>
            <span style="background:${riskBg};color:${riskColor};padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:700">
              ${riskLabel}
            </span>
          </div>

          <div style="font-size:11px;color:#666;margin-bottom:8px">
            Mã Cell: <code style="background:#e8f5e9;padding:2px 5px;border-radius:4px;color:#2e7d32;font-weight:600">${f.h3Index}</code>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px;background:#f8f9fa;padding:8px;border-radius:8px;text-align:center">
            <div>
              <div style="color:#777;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px">TỔNG CHUYẾN</div>
              <div style="font-weight:800;font-size:15px;color:#1565c0">${totalTrips}</div>
            </div>
            <div>
              <div style="color:#777;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px">TÀI XẾ</div>
              <div style="font-weight:800;font-size:15px;color:#6a1b9a">${drivers}</div>
            </div>
            <div>
              <div style="color:#777;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px">ĐIỂM GPS</div>
              <div style="font-weight:800;font-size:15px;color:#2e7d32">${f.count}</div>
            </div>
          </div>

          <div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="color:#555;font-size:11px;font-weight:600">Tỷ lệ bẻ lái / né tránh</span>
              <b style="color:${riskColor};font-size:12.5px">${avoidRatio.toFixed(1)}%</b>
            </div>
            <div style="background:#e0e0e0;border-radius:6px;height:7px;overflow:hidden">
              <div style="width:${Math.min(100, Math.round(avoidRatio))}%;height:100%;background:${riskColor};border-radius:6px"></div>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;font-size:11px;color:#444;margin-bottom:6px;background:#fff;padding:4px 8px;border:1px solid #eee;border-radius:6px">
            <span>✅ Đúng tuyến: <b>${normalTrips}</b></span>
            <span>🚨 Né tránh: <b style="color:#c62828">${highDevTrips}</b></span>
          </div>

          <div style="border-top:1px solid #eee;padding-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10.5px">
            <div>
              <div style="color:#888">Độ lệch trung bình</div>
              <div style="font-weight:700;color:#e65100">${fmtDev(avgDev)}</div>
            </div>
            <div>
              <div style="color:#888">Độ lệch tối đa</div>
              <div style="font-weight:700;color:#b71c1c">${fmtDev(maxDev)}</div>
            </div>
          </div>

          <div style="margin-top:6px;color:#aaa;font-size:9.5px">
            📌 Tọa độ tâm cell: ${centerLat.toFixed(5)}, ${centerLng.toFixed(5)}
          </div>
        </div>
      `)
      .addTo(map);
  } catch (err) {
    loading.remove();
  }
}

/**
 * HeatmapLayer:
 * 1. Smooth 2D heatmap gradient (toggleable)
 * 2. 3D H3 Hexagon Extrusion Grid (Res 12, radius < 10m, monochrome green scale, height ~ turn count)
 * 3. At zoom ≥ 14: individual GPS dots SNAPPED to the nearest road via OSRM
 * 4. Click anywhere on map → Vietnamese stats popup via /api/road-stats
 * 5. Selected trip: planned route (blue dashed) + actual GPS route (orange)
 */
export default function HeatmapLayer({
  map,
  points = [],
  selectedTrip = null,
  showHeatmap = true,
  show3DH3Grid = true,
}) {
  const initialized   = useRef(false);
  const clickHandler  = useRef(null);
  const snapCache     = useRef(new Map()); // key: "lng,lat" → snapped [lng,lat]
  const snapPending   = useRef(false);
  const show3DH3Ref   = useRef(show3DH3Grid);

  // Keep show3DH3Ref in sync
  useEffect(() => {
    show3DH3Ref.current = show3DH3Grid;
  }, [show3DH3Grid]);

  // ── Heatmap + dot layers + click handler ──────────────────────────────────
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
      // Raw GPS source (for heatmap + click detection) — optimized for 386k points
      map.addSource('hm-points', {
        type: 'geojson',
        data: geojson,
        tolerance: 2.5,
        buffer: 0,
      });

      // Snapped dots source (empty initially, filled lazily at high zoom)
      map.addSource('hm-snapped', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // ── Smooth heatmap (no maxzoom) ──
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

      // ── Invisible click-detection layer over heatmap (active only at zoom >= 14 for 60 FPS performance) ──
      map.addLayer({
        id: 'hm-hover',
        type: 'circle',
        source: 'hm-points',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 12, 18, 26],
          'circle-color': 'transparent',
          'circle-opacity': 0,
        },
      });

      // ── Snapped dots: colored by deviation, visible at zoom ≥ 14 ──
      map.addLayer({
        id: 'hm-snapped-dots',
        type: 'circle',
        source: 'hm-snapped',
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 4, 17, 7],
          'circle-color': ['interpolate', ['linear'], ['get', 'deviation'],
            0, '#00ff80', 5000, '#ffff00', 30000, '#ff8800', 100000, '#ff0040'],
          'circle-opacity': 0.92,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(0,0,0,0.5)',
        },
      });

      // ── Snap visible dots when map moves at high zoom ──
      const onMoveEnd = async () => {
        const zoom = map.getZoom();
        if (zoom < 14 || snapPending.current) return;

        const rawFeatures = map.queryRenderedFeatures({ layers: ['hm-hover'] });
        if (!rawFeatures.length) return;

        // Deduplicate and take max 48 visible points
        const seen = new Set();
        const toSnap = [];
        for (const f of rawFeatures) {
          const [lng, lat] = f.geometry.coordinates;
          const key = `${lng.toFixed(5)},${lat.toFixed(5)}`;
          if (!seen.has(key) && toSnap.length < 48) {
            seen.add(key);
            toSnap.push({ key, lng, lat, deviation: f.properties.deviation });
          }
        }

        // Separate cached vs uncached
        const uncached = toSnap.filter(p => !snapCache.current.has(p.key));

        if (uncached.length > 0) {
          snapPending.current = true;
          try {
            const snapped = await snapPointsBatch(uncached.map(p => [p.lng, p.lat]), 6);
            snapped.forEach((coord, i) => {
              if (coord) snapCache.current.set(uncached[i].key, coord);
            });
          } finally {
            snapPending.current = false;
          }
        }

        // Build snapped GeoJSON from cache — store original coords for click query
        const snappedFeatures = toSnap
          .filter(p => snapCache.current.has(p.key))
          .map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: snapCache.current.get(p.key) },
            properties: {
              deviation: p.deviation,
              orig_lng:  p.lng,   // original GPS lng (used for road-stats query)
              orig_lat:  p.lat,   // original GPS lat
            },
          }));

        const src = map.getSource('hm-snapped');
        if (src) src.setData({ type: 'FeatureCollection', features: snappedFeatures });
      };

      map.on('moveend', onMoveEnd);
      map.on('zoomend', onMoveEnd);

      // ── Click on snapped dot → show road stats popup (uses original GPS coords) ──
      map.on('click', 'hm-snapped-dots', async (e) => {
        if (show3DH3Ref.current) return; // Suppress general popups in 3D H3 mode
        e.originalEvent.stopPropagation();
        if (!e.features?.length) return;

        const f   = e.features[0];
        const dev = f.properties.deviation;
        const lat = f.properties.orig_lat ?? e.lngLat.lat;
        const lng = f.properties.orig_lng ?? e.lngLat.lng;

        await showRoadStatsPopup(map, e.lngLat, lat, lng, dev);
      });

      // ── General map click → Vietnamese road stats (areas without dots) ──
      const onMapClick = async (e) => {
        // Do NOT show general road-stats modal when 3D H3 grid is active
        if (show3DH3Ref.current) return;

        // Skip trip route layers
        for (const layer of ['trip-actual', 'trip-planned']) {
          if (map.getLayer(layer) && map.queryRenderedFeatures(e.point, { layers: [layer] }).length > 0) return;
        }
        // Skip if clicking directly on a snapped dot (handled by dot-specific handler)
        if (map.getLayer('hm-snapped-dots') &&
            map.queryRenderedFeatures(e.point, { layers: ['hm-snapped-dots'] }).length > 0) return;

        const { lng, lat } = e.lngLat;
        await showRoadStatsPopup(map, e.lngLat, lat, lng);
      };

      clickHandler.current = onMapClick;
      map.on('click', onMapClick);

      map.on('mouseenter', 'hm-snapped-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hm-snapped-dots', () => { map.getCanvas().style.cursor = ''; });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Toggle Heatmap & snapped-dots visibility ──────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;
    if (map.getLayer('hm-heat')) {
      map.setLayoutProperty('hm-heat', 'visibility', showHeatmap ? 'visible' : 'none');
    }
    if (map.getLayer('hm-snapped-dots')) {
      map.setLayoutProperty('hm-snapped-dots', 'visibility', (!show3DH3Grid && showHeatmap) ? 'visible' : 'none');
    }
  }, [map, showHeatmap, show3DH3Grid]);

  // ── Pre-compute 3D H3 Hexagon GeoJSON statically with Adaptive Resolution ─
  const h3GeoJSON = useMemo(() => {
    if (!points || points.length === 0) return { type: 'FeatureCollection', features: [] };

    // Adaptive Resolution based on point density:
    // >100k points (e.g. Porto 386k dataset): Res 12 (~25m) to prevent WebGL memory overflow
    // 30k - 100k points: Res 13 (~9m)
    // <30k points (e.g. driver trips / zoomed area): Res 14 (~3m) for street precision
    const resLevel = points.length > 100000 ? 12 : points.length > 30000 ? 13 : 14;

    const h3CellMap = new Map();
    let maxAvoidTrips = 1;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (!pt.lat || !pt.lng) continue;

      const cell = latLngToCell(pt.lat, pt.lng, resLevel);
      const isAvoidance = (pt.deviation || 0) > 50;
      const tripId = pt.trip_id || `pt-${i}`;
      const item = h3CellMap.get(cell);

      if (!item) {
        const avoidTripsSet = new Set();
        if (isAvoidance && tripId) avoidTripsSet.add(tripId);
        h3CellMap.set(cell, {
          cell,
          count: 1,
          avoidTripsSet: avoidTripsSet,
          totalDev: pt.deviation || 0,
          maxDev: pt.deviation || 0,
        });
      } else {
        item.count++;
        if (isAvoidance && tripId) item.avoidTripsSet.add(tripId);
        item.totalDev += (pt.deviation || 0);
        item.maxDev = Math.max(item.maxDev, pt.deviation || 0);
      }
    }

    for (const item of h3CellMap.values()) {
      const avoidTripsCount = item.avoidTripsSet ? item.avoidTripsSet.size : 0;
      if (avoidTripsCount > maxAvoidTrips) {
        maxAvoidTrips = avoidTripsCount;
      }
    }

    const features = [];
    for (const item of h3CellMap.values()) {
      try {
        const boundary = cellToBoundary(item.cell, true);
        if (!boundary || boundary.length === 0) continue;

        const avoidTripsCount = item.avoidTripsSet ? item.avoidTripsSet.size : 0;
        // Ratio based strictly on SỐ CHUYẾN XE NÉ TRÁNH THỰC TẾ (Unique Avoidance Trips)
        const ratio = maxAvoidTrips > 0 ? (avoidTripsCount / maxAvoidTrips) : 0;
        const avgDev = Math.round(item.totalDev / item.count);

        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [boundary] },
          properties: {
            h3Index: item.cell,
            count: item.count,
            avoidTripsCount: avoidTripsCount,
            ratio: ratio,
            res: resLevel,
            height: Math.max(4, Math.round(ratio * 140)), // Extrusion height strictly proportional to SỐ CHUYẾN NÉ TRÁNH (4m to 140m)
            avgDev: avgDev,
            maxDev: Math.round(item.maxDev),
          },
        });
      } catch (_) {}
    }

    return { type: 'FeatureCollection', features };
  }, [points]);

  // ── 3D H3 Hexagon Extrusion Grid Layer (~1.5m radius, Res 14) ──────────────
  useEffect(() => {
    if (!map) return;

    const sourceId = 'hm-3d-h3-src';
    const layerId  = 'hm-3d-h3-extrusion';

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: h3GeoJSON,
        tolerance: 1.5,
        buffer: 0,
      });

      map.addLayer({
        id: layerId,
        type: 'fill-extrusion',
        source: sourceId,
        layout: { visibility: show3DH3Grid ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'ratio'],
            0.00, '#00e664',   // Safe Fresh Mint Green (Low avoidance volume)
            0.25, '#ccee00',   // Light Yellow-Green
            0.50, '#ff9f43',   // High Orange (Significant avoidance)
            0.75, '#ff4444',   // Bright Red (Hotspot avoidance)
            1.00, '#b71c1c',   // Critical Deep Red Peak (Maximum avoidance volume)
          ],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.88,
        },
      });

      // Click on 3D H3 column → Show Rich Actionable Popup
      map.on('click', layerId, async (e) => {
        e.originalEvent.stopPropagation();
        if (!e.features?.length) return;
        const f = e.features[0].properties;
        await show3DH3CellPopup(map, e.lngLat, f);
      });

      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    } else {
      const src = map.getSource(sourceId);
      if (src) src.setData(h3GeoJSON);
    }

    // Toggle visibility and tilt camera for 3D perspective
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', show3DH3Grid ? 'visible' : 'none');
      if (show3DH3Grid) {
        map.easeTo({ pitch: 48, bearing: -18, duration: 1000 });
      } else {
        map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      }
    }
  }, [map, h3GeoJSON, show3DH3Grid]);

  // ── Selected trip route overlay ───────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    // Cleanup previous trip layers
    ['trip-planned-case','trip-planned','trip-actual-case','trip-actual',
     'trip-overlap-case','trip-overlap','trip-pts','trip-markers',
    ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
    ['trip-planned-src','trip-actual-src','trip-pts-src',
     'trip-overlap-src','trip-markers-src',
    ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });

    if (!selectedTrip) return;
    const { coords, matchedRoute, plannedRoute } = selectedTrip;
    if (!coords || coords.length < 2) return;

    const actualCoords  = matchedRoute || coords;
    const plannedCoords = plannedRoute || [coords[0], coords[coords.length - 1]];

    // ── Overlap detection ────────────────────────────────────────────────────
    // For each point in actualCoords, check if it's within 25m of the planned route
    function ptSegDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (dx === 0 && dy === 0) {
        const ex = p[0]-a[0], ey = p[1]-a[1];
        return Math.sqrt(ex*ex + ey*ey) * 111320;
      }
      const t = Math.max(0, Math.min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)));
      const ex = p[0] - (a[0]+t*dx), ey = p[1] - (a[1]+t*dy);
      return Math.sqrt(ex*ex + ey*ey) * 111320; // rough meters
    }
    function minDistToRoute(pt, route) {
      let min = Infinity;
      for (let j = 0; j < route.length - 1; j++) {
        const d = ptSegDist(pt, route[j], route[j+1]);
        if (d < min) min = d;
      }
      return min;
    }

    const OVERLAP_THRESHOLD_M = 25;
    const isOverlap = actualCoords.map(pt => minDistToRoute(pt, plannedCoords) < OVERLAP_THRESHOLD_M);

    // Extract continuous overlapping line segments
    const overlapSegments = [];
    let cur = null;
    for (let i = 0; i < actualCoords.length; i++) {
      if (isOverlap[i]) {
        if (!cur) cur = [actualCoords[i]];
        else cur.push(actualCoords[i]);
      } else {
        if (cur && cur.length >= 2) overlapSegments.push(cur);
        cur = null;
      }
    }
    if (cur && cur.length >= 2) overlapSegments.push(cur);

    // Build GeoJSONs
    const actualGeoJSON = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: actualCoords } }],
    };
    const plannedGeoJSON = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: plannedCoords } }],
    };
    const overlapGeoJSON = {
      type: 'FeatureCollection',
      features: overlapSegments.map(seg => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: seg } })),
    };
    const markersGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: actualCoords[0] }, properties: { role: 'start' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: actualCoords[actualCoords.length - 1] }, properties: { role: 'end' } },
      ],
    };

    map.addSource('trip-actual-src', { type: 'geojson', data: actualGeoJSON });
    map.addSource('trip-planned-src', { type: 'geojson', data: plannedGeoJSON });
    map.addSource('trip-overlap-src', { type: 'geojson', data: overlapGeoJSON });
    map.addSource('trip-markers-src', { type: 'geojson', data: markersGeoJSON });
    map.addSource('trip-pts-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: coords.map((c, i) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { idx: i },
        })),
      },
    });

    // ── Planned route: blue dashed ────────────────────────────────────────────
    map.addLayer({ id: 'trip-planned-case', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.15 },
    });
    map.addLayer({ id: 'trip-planned', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#29b6f6', 'line-width': 4, 'line-dasharray': [5, 4], 'line-opacity': 0.9 },
    });

    // ── Actual route: orange ──────────────────────────────────────────────────
    map.addLayer({ id: 'trip-actual-case', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.35 },
    });
    map.addLayer({ id: 'trip-actual', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.95 },
    });

    // ── Overlap segments: purple ──────────────────────────────────────────────
    if (overlapSegments.length > 0) {
      map.addLayer({ id: 'trip-overlap-case', type: 'line', source: 'trip-overlap-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.3 },
      });
      map.addLayer({ id: 'trip-overlap', type: 'line', source: 'trip-overlap-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e040fb', 'line-width': 5, 'line-opacity': 1.0 },
      });
    }

    // ── Raw GPS dots (visible at zoom ≥ 13) ──────────────────────────────────
    map.addLayer({ id: 'trip-pts', type: 'circle', source: 'trip-pts-src', minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 4],
        'circle-color': '#fff', 'circle-opacity': 0.65,
        'circle-stroke-width': 1.2, 'circle-stroke-color': '#ff6b35',
      },
    });

    // ── Start / End markers ───────────────────────────────────────────────────
    map.addLayer({ id: 'trip-markers', type: 'circle', source: 'trip-markers-src',
      paint: {
        'circle-radius': 10,
        'circle-color': [
          'match', ['get', 'role'],
          'start', '#00e676',  // bright green = start
          'end',   '#ff1744',  // bright red = end
          '#fff'
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
        'circle-opacity': 1.0,
      },
    });

    // Cursor changes
    map.on('mouseenter', 'trip-actual',  () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-actual',  () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'trip-planned', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-planned', () => { map.getCanvas().style.cursor = ''; });

    // Fit map to trip location
    const all = [...actualCoords, ...plannedCoords];
    if (all.length > 0) {
      const lngs = all.map(c => c[0]), lats = all.map(c => c[1]);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);

      if (minLng === maxLng && minLat === maxLat) {
        map.flyTo({ center: [minLng, minLat], zoom: 15, duration: 1200 });
      } else {
        map.fitBounds(
          [[minLng, minLat], [maxLng, maxLat]],
          { padding: 100, duration: 1200, maxZoom: 15 }
        );
      }
    }
  }, [map, selectedTrip]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (!map || !initialized.current) return;
      if (clickHandler.current) map.off('click', clickHandler.current);
      ['hm-heat','hm-hover','hm-snapped-dots','hm-3d-h3-extrusion',
        'trip-planned-case','trip-planned','trip-actual-case','trip-actual',
        'trip-overlap-case','trip-overlap','trip-pts','trip-markers',
      ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
      ['hm-points','hm-snapped','hm-3d-h3-src',
        'trip-planned-src','trip-actual-src','trip-overlap-src',
        'trip-pts-src','trip-markers-src',
      ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });
      initialized.current = false;
    };
  }, [map]);

  return null;
}

