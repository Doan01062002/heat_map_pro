import { useEffect, useRef, useMemo } from 'react';
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

// ── Lixel Binning: Build road-segment GeoJSON from trajectory + deviation data ──
/**
 * buildRoadSegmentAggregatedGeoJSON — Lixel Binning implementation.
 *
 * Algorithm:
 *   1. Collect all GPS coords from trajectories (LineString coordinates).
 *   2. For each consecutive pair of coordinates (A → B), create a "segment key"
 *      by snapping both endpoints to an H3 cell at res 11 (~25m) and joining them.
 *      This groups nearby GPS noise into the same segment.
 *   3. Count how many deviation events fall near each segment (using a bounding box
 *      around the midpoint of each segment pair).
 *   4. Return GeoJSON FeatureCollection of LineString features with `intensity`.
 *
 * Complexity: O(N * M) where N = trajectory segments, M = deviation points.
 * For large datasets, this is fast enough at UI level (<500ms for 5000 points).
 *
 * @param {Array} trajectories - Array of trip objects with `coords: [[lng,lat],...]`
 * @param {Array} points       - Array of deviation events with {lat, lng, deviation}
 * @returns {object} GeoJSON FeatureCollection
 */
function buildRoadSegmentAggregatedGeoJSON(trajectories, points) {
  // ── Phase 1: Build spatial grid of deviation points O(M) ─────────────────
  // Grid cell = 0.002° ≈ 200m — matches the proximity tolerance below.
  const GRID = 0.002;
  const ptGrid = new Map(); // gridKey → count

  for (const pt of points) {
    const gx = Math.round(pt.lng / GRID);
    const gy = Math.round(pt.lat / GRID);
    const gk = `${gx},${gy}`;
    ptGrid.set(gk, (ptGrid.get(gk) || 0) + 1);
  }

  // ── Phase 2: Build segment map and look up grid O(N) ─────────────────────
  const segMap = new Map();

  for (const trip of trajectories) {
    const coords = trip.coords;
    if (!coords || coords.length < 2) continue;

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];   // [lng, lat]
      const b = coords[i + 1];

      // Merge nearby segments: round to 4 decimal places (~11m)
      const ak = `${a[0].toFixed(4)},${a[1].toFixed(4)}`;
      const bk = `${b[0].toFixed(4)},${b[1].toFixed(4)}`;
      const key = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;

      if (!segMap.has(key)) {
        // Compute midpoint and look up in spatial grid (O(1))
        const midLng = (a[0] + b[0]) / 2;
        const midLat = (a[1] + b[1]) / 2;
        const gx = Math.round(midLng / GRID);
        const gy = Math.round(midLat / GRID);

        // Check the cell and its 8 neighbours to avoid boundary misses
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            count += ptGrid.get(`${gx + dx},${gy + dy}`) || 0;
          }
        }

        segMap.set(key, { coords: [a, b], count });
      }
    }
  }

  // ── Fallback: if no trajectories, build from points directly ─────────────
  if (segMap.size === 0 && points.length > 1) {
    // Sample max 500 points to avoid O(M²) segments
    const sampled = points.length > 500
      ? points.filter((_, i) => i % Math.floor(points.length / 500) === 0)
      : points;
    for (let i = 0; i < sampled.length - 1; i++) {
      const a = [sampled[i].lng, sampled[i].lat];
      const b = [sampled[i + 1].lng, sampled[i + 1].lat];
      const ak = `${a[0].toFixed(3)},${a[1].toFixed(3)}`;
      const bk = `${b[0].toFixed(3)},${b[1].toFixed(3)}`;
      const key = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
      if (!segMap.has(key)) segMap.set(key, { coords: [a, b], count: 1 });
      else segMap.get(key).count++;
    }
  }

  // ── Phase 3: Build GeoJSON — only segments with events ───────────────────
  const features = [];
  for (const seg of segMap.values()) {
    if (seg.count === 0) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: seg.coords },
      properties: { intensity: seg.count },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * HeatmapLayer:
 * 1. Smooth heatmap gradient (toggleable)
 * 2. Heat-Lines: aggregated road segments colored by deviation event density
 * 3. At zoom ≥ 14: individual GPS dots SNAPPED to nearest road via OSRM
 * 4. Click anywhere → Vietnamese stats popup via /api/road-stats
 * 5. Selected trip: planned route (blue dashed) + actual GPS route (orange)
 */
export default function HeatmapLayer({
  map,
  points = [],
  selectedTrip = null,
  trajectories = [],
  showHeatmap = true,
  showTrajectories = true,
}) {
  const initialized   = useRef(false);
  const clickHandler  = useRef(null);
  const snapCache     = useRef(new Map());
  const snapPending   = useRef(false);

  // ── Toggle Heatmap visibility ──────────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;
    if (map.getLayer('hm-heat')) {
      map.setLayoutProperty('hm-heat', 'visibility', showHeatmap ? 'visible' : 'none');
    }
  }, [map, showHeatmap]);

  // ── Toggle Heat-Lines / Road Overlay visibility ────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;
    // Toggle snapped dots
    if (map.getLayer('hm-snapped-dots')) {
      map.setLayoutProperty('hm-snapped-dots', 'visibility', showTrajectories ? 'visible' : 'none');
    }
    // Road overlay layers are toggled separately in the road-overlay useEffect
  }, [map, showTrajectories]);

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
      // Raw GPS source (for heatmap + click detection)
      map.addSource('hm-points', { type: 'geojson', data: geojson });

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

      // ── Invisible click-detection layer over heatmap ──
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
        e.originalEvent.stopPropagation(); // prevent general map click from also firing
        if (!e.features?.length) return;

        const f   = e.features[0];
        const dev = f.properties.deviation;
        // Use original GPS coordinates for DB query (they match deviation_events table)
        const lat = f.properties.orig_lat ?? e.lngLat.lat;
        const lng = f.properties.orig_lng ?? e.lngLat.lng;

        await showRoadStatsPopup(map, e.lngLat, lat, lng, dev);
      });

      // ── General map click → Vietnamese road stats (areas without dots) ──
      const onMapClick = async (e) => {
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

      map.on('mouseenter', 'hm-hover',        () => { map.getCanvas().style.cursor = 'crosshair'; });
      map.on('mouseleave', 'hm-hover',        () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'hm-snapped-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hm-snapped-dots', () => { map.getCanvas().style.cursor = ''; });

      initialized.current = true;
    } else {
      const src = map.getSource('hm-points');
      if (src) src.setData(geojson);
    }
  }, [map, points]);

  // ── Road Traffic Overlay: Extract road geometry from basemap tiles ────────
  // Strategy: query rendered road features from Carto basemap vector tiles,
  // extract their ACTUAL road-following geometry, compute intensity from
  // deviation grid, build a NEW GeoJSON source with road-shaped LineStrings.
  // Result: colored lines that follow real road curves (like Google Maps).

  // Road layer IDs from Carto dark-matter basemap
  const ROAD_LAYERS = [
    'road_mot_fill_noramp', 'road_trunk_fill_noramp', 'road_pri_fill_noramp',
    'road_sec_fill_noramp', 'road_minor_fill', 'road_service_fill',
    'road_pri_fill_ramp', 'road_trunk_fill_ramp', 'road_mot_fill_ramp',
  ];

  // Build spatial grid from deviation points — O(M), memoized
  const densityGrid = useMemo(() => {
    const GRID = 0.0012; // ~133m cells — finer grid for road-level precision
    const grid = new Map();
    for (const pt of points) {
      const gx = Math.round(pt.lng / GRID);
      const gy = Math.round(pt.lat / GRID);
      grid.set(`${gx},${gy}`, (grid.get(`${gx},${gy}`) || 0) + 1);
    }
    return { grid, GRID };
  }, [points]);

  // Extract road geometries + build overlay on viewport change
  useEffect(() => {
    if (!map || !initialized.current) return;
    if (points.length === 0) return;

    const { grid, GRID } = densityGrid;

    // Ensure overlay source + layers exist
    if (!map.getSource('hm-road-overlay')) {
      map.addSource('hm-road-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Casing layer (dark outline for contrast)
      map.addLayer({
        id: 'hm-road-case',
        type: 'line',
        source: 'hm-road-overlay',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#000',
          'line-width': ['interpolate', ['linear'], ['get', 'intensity'],
            1, 4, 5, 6, 15, 8, 40, 11],
          'line-opacity': 0.25,
        },
      });

      // Colored traffic line (Google Maps style)
      map.addLayer({
        id: 'hm-road-line',
        type: 'line',
        source: 'hm-road-overlay',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['interpolate', ['linear'], ['get', 'intensity'],
            1,  '#4285F4',   // Blue (low)
            4,  '#34A853',   // Green (medium)
            10, '#FBBC05',   // Yellow (high)
            20, '#EA4335',   // Red (very high)
            50, '#B71C1C',   // Dark red (extreme)
          ],
          'line-width': ['interpolate', ['linear'], ['get', 'intensity'],
            1, 2.5, 5, 3.5, 15, 5, 40, 7],
          'line-opacity': 0.9,
        },
      });
    }

    // Function to extract road geometry and compute intensity
    const updateRoadOverlay = () => {
      if (!map.isStyleLoaded()) return;

      // Query visible road features from basemap
      const existingLayers = ROAD_LAYERS.filter(id => map.getLayer(id));
      if (existingLayers.length === 0) return;

      const rawFeatures = map.queryRenderedFeatures(undefined, {
        layers: existingLayers,
      });

      // Deduplicate by geometry hash (Carto tiles have no stable IDs)
      const seen = new Set();
      const features = [];

      for (const f of rawFeatures) {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) continue;

        // Flatten MultiLineString
        const lines = f.geometry.type === 'MultiLineString' ? coords : [coords];

        for (const line of lines) {
          if (line.length < 2) continue;

          // Create a geometry hash from first+last points (fast dedup)
          const hash = `${line[0][0].toFixed(5)},${line[0][1].toFixed(5)}|${line[line.length-1][0].toFixed(5)},${line[line.length-1][1].toFixed(5)}|${line.length}`;
          if (seen.has(hash)) continue;
          seen.add(hash);

          // Sample points along the road and count nearby deviation events
          let intensity = 0;
          const step = Math.max(1, Math.floor(line.length / 6));
          for (let i = 0; i < line.length; i += step) {
            const [lng, lat] = line[i];
            const gx = Math.round(lng / GRID);
            const gy = Math.round(lat / GRID);
            for (let dx = -1; dx <= 1; dx++) {
              for (let dy = -1; dy <= 1; dy++) {
                intensity += grid.get(`${gx + dx},${gy + dy}`) || 0;
              }
            }
          }

          // Only include roads with at least 1 nearby deviation event
          if (intensity > 0) {
            features.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: line },
              properties: { intensity },
            });
          }
        }
      }

      // Update GeoJSON source
      const src = map.getSource('hm-road-overlay');
      if (src) {
        src.setData({ type: 'FeatureCollection', features });
      }
    };

    // Debounce viewport updates to avoid jank during pan/zoom
    let timer;
    const debouncedUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(updateRoadOverlay, 200);
    };

    // Initial update + re-update on viewport change
    updateRoadOverlay();
    map.on('moveend', debouncedUpdate);

    return () => {
      clearTimeout(timer);
      map.off('moveend', debouncedUpdate);
    };
  }, [map, points, densityGrid]);

  // ── Toggle road-overlay visibility ────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;
    ['hm-road-case', 'hm-road-line'].forEach(id => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', showTrajectories ? 'visible' : 'none');
      }
    });
    // Hide old spider-web layers if they still exist
    ['hm-seg-case', 'hm-seg-line'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    });
  }, [map, showTrajectories]);

  // ── Selected trip route overlay ───────────────────────────────────────────
  useEffect(() => {
    if (!map || !initialized.current) return;

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

    const overlapGeoJSON = {
      type: 'FeatureCollection',
      features: overlapSegments.map(seg => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: seg },
        properties: {},
      })),
    };

    // ── Start / End markers ───────────────────────────────────────────────────
    const startPt = actualCoords[0];
    const endPt   = actualCoords[actualCoords.length - 1];
    const markersGeoJSON = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: startPt }, properties: { role: 'start' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: endPt   }, properties: { role: 'end'   } },
      ],
    };

    // ── Add sources ───────────────────────────────────────────────────────────
    map.addSource('trip-planned-src', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: plannedCoords }, properties: {} },
    });
    map.addSource('trip-actual-src', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: actualCoords }, properties: {} },
    });
    map.addSource('trip-overlap-src', { type: 'geojson', data: overlapGeoJSON });
    map.addSource('trip-markers-src', { type: 'geojson', data: markersGeoJSON });
    map.addSource('trip-pts-src', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: actualCoords.map((c, i) => ({
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

    // Fit map to trip
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
      ['hm-heat','hm-hover','hm-snapped-dots','hm-seg-case','hm-seg-line',
        'trip-planned-case','trip-planned','trip-actual-case','trip-actual',
        'trip-overlap-case','trip-overlap','trip-pts','trip-markers',
      ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) {} });
      ['hm-points','hm-snapped','hm-segments',
        'trip-planned-src','trip-actual-src','trip-overlap-src',
        'trip-pts-src','trip-markers-src',
      ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) {} });
      initialized.current = false;
    };
  }, [map]);

  return null;
}

