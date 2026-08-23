import { useEffect, useRef, useState } from 'react';
import { cellToBoundary } from 'h3-js';
import { snapPointsBatch } from '../utils/osrmRouting';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// ── Pre-computed hex vertex trig lookup (module-level, computed once) ─────────
// 7 vertices for a flat-top regular hexagon, angles: -30, 30, 90, 150, 210, 270, -30 (close)
const _HEX_ANGLES = [0, 1, 2, 3, 4, 5, 6].map(i => (Math.PI / 180) * (60 * i - 30));
const HEX_COS = _HEX_ANGLES.map(a => Math.cos(a));
const HEX_SIN = _HEX_ANGLES.map(a => Math.sin(a));

// ── Zoom-Adaptive H3 Resolution ────────────────────────────────────────────
// Khi zoom sâu hơn → resolution cao hơn → ô lưới nhỏ hơn (chi tiết hơn).
// Resolution tối đa = 14 (ô ~1m, mức chi tiết cao nhất khi zoom sâu nhất).
const H3_RES_SIZE = { 9: '~174m', 10: '~66m', 11: '~25m', 12: '~9m', 13: '~3m', 14: '~1m' };

/**
 * zoomToH3Resolution — Ánh xạ zoom level của bản đồ sang H3 resolution (9–14).
 * Mỗi bước resolution chia đôi kích thước ô, chỉ re-compute khi vượt ngưỡng.
 * @param {number} zoom  MapLibre zoom level
 * @returns {number}  H3 resolution từ 9 đến 14
 */
function zoomToH3Resolution(zoom) {
  if (zoom < 10) return 9;   // ~174m/ô — toàn thành phố
  if (zoom < 12) return 10;  // ~66m/ô  — quận / khu vực
  if (zoom < 14) return 11;  // ~25m/ô  — đường phố
  if (zoom < 16) return 12;  // ~9m/ô   — ngã tư
  if (zoom < 18) return 13;  // ~3m/ô   — làn xe
  return 14;                 // ~1m/ô   — MAX, chi tiết nhất
}


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
  const zoom = map.getZoom();
  const radius = zoom < 10 ? 300 : zoom < 12 ? 200 : zoom < 14 ? 150 : 100;

  const PopupClass = map._maplibregl?.Popup || window.maplibregl?.Popup;

  const loading = new PopupClass({ offset: 12, maxWidth: '270px' })
    .setLngLat(popupLngLat)
    .setHTML(`
      <div style="font-family:Inter,sans-serif;color:#333;font-size:13px;line-height:1.6">
        <div style="font-weight:700;margin-bottom:4px">📍 Đang tải thống kê…</div>
        ${hintDev != null ? `<div style="color:#e65100;font-size:11px">Độ lệch: ${hintDev >= 1000 ? (hintDev / 1000).toFixed(1) + ' km' : Math.round(hintDev) + ' m'}</div>` : ''}
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

    const fmtDev = v => v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;
    const ratio = d.avoid_ratio.toFixed(1);
    const iColor = d.avoid_ratio < 20 ? '#00b894'
      : d.avoid_ratio < 50 ? '#fdcb6e'
        : d.avoid_ratio < 75 ? '#e17055' : '#d63031';
    const barW = Math.min(100, Math.round(d.avoid_ratio));

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
async function show3DH3CellPopup(map, popupLngLat, cellProps, points = []) {
  const PopupClass = map._maplibregl?.Popup || window.maplibregl?.Popup;
  const f = cellProps;

  // Server already provides center_lat/center_lng + bbox from CellToBoundary().
  // No need to call h3-js cellToBoundary() — the server grid format is incompatible.
  let centerLat = f.center_lat || popupLngLat?.lat || 0;
  let centerLng = f.center_lng || popupLngLat?.lng || 0;
  const minLat = centerLat - 0.0005;
  const maxLat = centerLat + 0.0005;
  const minLng = centerLng - 0.0005;
  const maxLng = centerLng + 0.0005;
  // Use cell index (server format) for display; fall back to h3Index for backward compat
  const cellId = f.cell || f.h3Index || '?';

  const loading = new PopupClass({ offset: 12, maxWidth: '300px' })
    .setLngLat(popupLngLat)
    .setHTML(`
      <div style="font-family:Inter,sans-serif;color:#333;font-size:13px;line-height:1.6;padding:2px">
        <div style="font-weight:700;margin-bottom:4px;color:#1b5e20">📊 Đang phân tích ô 3D H3…</div>
        <div style="color:#666;font-size:11px">Mã Cell: <code style="background:#e8f5e9;padding:2px 4px;border-radius:4px;color:#2e7d32">${cellId}</code></div>
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

    const fmtDev = v => v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;

    // Server provides aggregated stats directly in cell properties:
    // avoid_trips, total_trips, avg_dev, max_dev
    const highDevTrips = f.avoid_trips ?? (dbStats?.high_dev_trips ?? 0);
    const totalTrips = f.total_trips ?? (dbStats?.unique_trips ?? f.count ?? 0);
    // unique_drivers: now provided directly by backend h3-aggregate (distinct driver_ids).
    // Falls back to dbStats then to totalTrips only if neither is available.
    const drivers = f.unique_drivers ?? (dbStats?.unique_drivers ?? totalTrips);
    const normalTrips = Math.max(0, totalTrips - highDevTrips);
    const avoidRatio = totalTrips > 0 ? ((highDevTrips / totalTrips) * 100) : 0;
    const avgDev = f.avg_dev ?? (dbStats?.avg_deviation ?? 0);
    const maxDev = f.max_dev ?? (dbStats?.max_deviation ?? 0);

    const riskLabel = avoidRatio > 50 ? '🔴 Rủi ro Bẻ lái Cao' : avoidRatio > 20 ? '🟡 Cảnh báo Né tránh' : '🟢 An toàn (Đúng tuyến)';
    const riskBg = avoidRatio > 50 ? '#ffebee' : avoidRatio > 20 ? '#fff8e1' : '#e8f5e9';
    const riskColor = avoidRatio > 50 ? '#c62828' : avoidRatio > 20 ? '#f57f17' : '#2e7d32';

    new PopupClass({ offset: 12, maxWidth: '315px', closeButton: true })
      .setLngLat(popupLngLat)
      .setHTML(`
        <div class="custom-thin-scroll" style="font-family:Inter,system-ui,sans-serif;font-size:12px;color:#111;line-height:1.75;max-height:80vh;overflow-y:auto;padding-right:2px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:800;font-size:13.5px;color:#1b5e20">
              🛑 Ô 3D H3 (Res ${f.res || 14} · ${H3_RES_SIZE[f.res] || '~1m'})
            </div>
            <span style="background:${riskBg};color:${riskColor};padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:700">
              ${riskLabel}
            </span>
          </div>

          <div style="font-size:11px;color:#666;margin-bottom:8px">
            Mã Cell: <code style="background:#e8f5e9;padding:2px 5px;border-radius:4px;color:#2e7d32;font-weight:600">${cellId}</code>
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

          <button id="ai-investigate-btn-${f.h3Index}" style="margin-top:10px;width:100%;background:linear-gradient(135deg,#6c63ff,#4834d4);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;box-shadow:0 2px 8px rgba(108,99,255,0.3);transition:all .2s">
            <span>AI Chẩn Đoán Thực Tế</span>
          </button>
          <div id="ai-result-box-${f.h3Index}" style="display:none;margin-top:10px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:8px;padding:10px;font-size:11px;color:#222"></div>
        </div>
      `)
      .addTo(map);

    // Attach click listener for AI Agent Investigation button
    setTimeout(() => {
      const btn = document.getElementById(`ai-investigate-btn-${f.h3Index}`);
      const box = document.getElementById(`ai-result-box-${f.h3Index}`);

      if (btn && box) {
        btn.onclick = async () => {
          btn.disabled = true;
          btn.innerHTML = '<span>⏳ Agent đang thu thập bằng chứng...</span>';
          btn.style.opacity = '0.7';

          try {
            const targetTimeMs = dbStats?.created_at
              ? new Date(dbStats.created_at).getTime()
              : (f.created_at || (Array.isArray(points) && points.length > 0 && points[0]?.created_at ? new Date(points[0].created_at).getTime() : 1372694282000));

            const res = await fetch(`${API_URL}/api/ai/investigate`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                h3_index: cellId,
                lat: centerLat,
                lng: centerLng,
                time_window_minutes: 60,
                timestamp_ms: targetTimeMs,
                // Pass exact bbox matching road-stats query → AI uses same data scope as popup
                min_lat: minLat,
                max_lat: maxLat,
                min_lng: minLng,
                max_lng: maxLng,
                // Live session stats shown in popup (primary source of truth for AI)
                session_drivers: drivers,
                session_trips: totalTrips,
                session_high_dev_trips: highDevTrips,
                session_deviation_ratio: avoidRatio / 100, // convert % → 0-1 ratio
                session_avg_deviation_m: avgDev,
                // Pass the far edge of the H3 cell as the approximate trip end point
                end_lat: maxLat || (centerLat + 0.003),
                end_lng: maxLng || centerLng,
              }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            btn.style.display = 'none';
            box.style.display = 'block';

            // Auto pan camera so the expanded popup with AI analysis is fully visible above bottom bars
            if (map && map.easeTo) {
              map.easeTo({
                center: [centerLng, centerLat],
                offset: [0, 160],
                duration: 500,
              });
            }

            const riskBg = data.risk_level === 'SAFE_FORCE_MAJEURE' ? '#e8f5e9' : data.risk_level === 'SUSPICIOUS' ? '#fffde7' : '#fce4ec';
            const riskColor = data.risk_level === 'SAFE_FORCE_MAJEURE' ? '#2e7d32' : data.risk_level === 'SUSPICIOUS' ? '#e65100' : '#c62828';
            const riskIcon = data.risk_level === 'SAFE_FORCE_MAJEURE' ? '🟢' : data.risk_level === 'SUSPICIOUS' ? '🟡' : '🔴';
            const riskLabel = data.risk_level === 'SAFE_FORCE_MAJEURE' ? 'Có nguyên nhân khách quan' : data.risk_level === 'SUSPICIOUS' ? 'Cần theo dõi thêm' : 'Bất thường cao';

            const locationStr = data.evidence?.location_name || '';
            const confPct = (data.confidence * 100).toFixed(0);

            // Use new structured fields, fallback to legacy summary if observation is empty
            const observation = data.observation || data.summary || '';
            const context = data.context || '';
            const conclusion = data.conclusion || data.recommendation || '';

            // Compact environment badges
            const weather = data.evidence?.weather;
            const traffic = data.evidence?.traffic_speed;
            const telemetry = data.evidence?.fleet_telemetry;

            let envBadges = '';
            if (weather) {
              const weatherIcon = (weather.rain_mm || 0) >= 5 ? '🌧️' : '☀️';
              envBadges += `<span style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:10px;color:#555">${weatherIcon} ${weather.temperature ?? ''}°C · ${weather.rain_mm ?? 0}mm/h</span> `;
            }
            if (traffic) {
              const tIcon = traffic.traffic_state === 'SEVERE_GRIDLOCK' ? '🔴' : traffic.traffic_state === 'MODERATE_SLOW' ? '🟡' : '🟢';
              envBadges += `<span style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:10px;color:#555">${tIcon} ${traffic.current_speed_kmh}/${traffic.baseline_speed_kmh} km/h</span> `;
            }
            if (telemetry) {
              envBadges += `<span style="background:#f5f5f5;padding:2px 6px;border-radius:4px;font-size:10px;color:#555">👥 ${telemetry.unique_drivers} tài xế · ${telemetry.unique_trips} chuyến</span>`;
            }

            box.innerHTML = `
              <div style="border-left:3px solid ${riskColor};padding-left:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                  <span style="background:${riskBg};color:${riskColor};padding:3px 10px;border-radius:12px;font-weight:700;font-size:11px">${riskIcon} ${riskLabel}</span>
                  <span style="color:#999;font-size:9.5px">Độ tin cậy ${confPct}%</span>
                </div>

                ${locationStr ? `<div style="color:#1a237e;font-weight:600;font-size:11px;margin-bottom:8px">📍 ${locationStr}</div>` : ''}

                <div style="margin-bottom:8px">
                  <div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Hiện tượng</div>
                  <div style="color:#222;font-size:11.5px;line-height:1.5">${observation}</div>
                </div>

                <div style="margin-bottom:8px">
                  <div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Bối cảnh</div>
                  <div style="color:#222;font-size:11.5px;line-height:1.5">${context}</div>
                </div>

                <div style="background:${riskBg};padding:8px 10px;border-radius:6px;margin-bottom:6px">
                  <div style="color:${riskColor};font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Kết luận</div>
                  <div style="color:#222;font-size:11.5px;line-height:1.5">${conclusion}</div>
                </div>

                <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${envBadges}</div>
              </div>
            `;

            setTimeout(() => {
              box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
          } catch (err) {
            btn.disabled = false;
            btn.innerHTML = '<span>⚠️ AI bận. Bấm để thử lại</span>';
            btn.style.opacity = '1';
            console.warn('[AI Investigate Error]', err);
          }
        };
      }
    }, 100);
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
  showActualPath = false,
  actualPathCells = [],
  historyFrom = null,  // Unix ms — used for viewport bbox fetch at high zoom
  historyTo = null,    // Unix ms
  apiUrl = 'http://localhost:8080',
}) {
  const initialized = useRef(false);
  const clickHandler = useRef(null);
  const snapCache = useRef(new Map()); // key: "lng,lat" → snapped [lng,lat]
  const snapPending = useRef(false);
  const show3DH3Ref = useRef(show3DH3Grid);
  const showActualPathRef = useRef(showActualPath);

  // Self-fetched actual-path cells (fallback when prop is empty and layer is ON)
  const [selfActualPathCells, setSelfActualPathCells] = useState([]);

  // H3 resolution thích ứng zoom: khởi tạo mặc định Res 12 (~9m), sẽ cập nhật khi map mount
  const [h3Resolution, setH3Resolution] = useState(12);

  // ── Web Worker state & refs ───────────────────────────────────────────────
  // Computed GeoJSON from worker (replaces the two useMemos):
  const [h3GeoJSON, setH3GeoJSON] = useState({ type: 'FeatureCollection', features: [] });
  const [actualPathH3GeoJSON, setActualPathH3GeoJSON] = useState({ type: 'FeatureCollection', features: [] });

  // Worker singleton — created once, terminated on unmount
  const workerRef = useRef(null);

  // LRU cache: key = `${resLevel}` at low zoom, `${resLevel}:${bboxHash}` at high zoom
  // Each entry: { h3GeoJSON, actualPathH3GeoJSON }
  // Cache is invalidated when `points` array reference changes (new data load).
  const h3GeoJSONCacheRef = useRef(new Map());
  const cachedPointsRef = useRef(null); // tracks which points array is cached

  // At high zoom (res >= 11), we fetch viewport-specific points from backend.
  // This ref holds the currently fetched viewport points.
  const viewportPointsRef = useRef(null);
  const viewportFetchAbortRef = useRef(null); // AbortController for in-flight fetch

  // Keep show3DH3Ref in sync
  useEffect(() => {
    show3DH3Ref.current = show3DH3Grid;
  }, [show3DH3Grid]);

  // Keep showActualPathRef in sync
  useEffect(() => {
    showActualPathRef.current = showActualPath;
  }, [showActualPath]);

  // Self-fetch actual-path cells when layer is toggled ON and prop is still empty
  useEffect(() => {
    if (!showActualPath) return;
    if (actualPathCells && actualPathCells.length > 0) return; // already have data from parent
    if (selfActualPathCells.length > 0) return; // already self-fetched

    const PORTO_FROM = 1372636800000;
    const toMs = Date.now() + 86400000;
    fetch(`${API_URL}/api/actual-path?from=${PORTO_FROM}&to=${toMs}`)
      .then(r => r.json())
      .then(data => {
        if (data.cells && data.cells.length > 0) {
          setSelfActualPathCells(data.cells);
        }
      })
      .catch(err => console.warn('[HeatmapLayer] actual-path self-fetch failed:', err));
  }, [showActualPath, actualPathCells]);

  // ── Zoom-adaptive H3 resolution listener ────────────────────────────────
  // Debounce 300ms: chỉ re-compute khi zoom vượt ngưỡng resolution tier, không
  // re-compute trên từng frame zoom — tránh lag với 386k+ điểm GPS.
  useEffect(() => {
    if (!map) return;
    // Đồng bộ ngay với zoom hiện tại khi map mới mount
    setH3Resolution(zoomToH3Resolution(map.getZoom()));

    let timer = null;
    const onZoomEnd = () => {
      clearTimeout(timer);
      // 500ms debounce (up from 300ms) — prevents spamming the Worker during
      // fast continuous zoom gestures on the Porto 386k-point dataset.
      timer = setTimeout(() => {
        setH3Resolution(prev => {
          const next = zoomToH3Resolution(map.getZoom());
          return prev !== next ? next : prev; // Chỉ update khi đổi resolution tier thật sự
        });
      }, 500);
    };

    map.on('zoomend', onZoomEnd);
    return () => {
      map.off('zoomend', onZoomEnd);
      clearTimeout(timer);
    };
  }, [map]);

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
              orig_lng: p.lng,   // original GPS lng (used for road-stats query)
              orig_lat: p.lat,   // original GPS lat
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

        const f = e.features[0];
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

        // Skip if clicking on the actual-path extrusion layer (purple hexes)
        if (map.getLayer('hm-3d-actual-extrusion') &&
          map.queryRenderedFeatures(e.point, { layers: ['hm-3d-actual-extrusion'] }).length > 0) return;

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
    if (map.getLayer('hm-3d-actual-extrusion')) {
      map.setLayoutProperty('hm-3d-actual-extrusion', 'visibility', showActualPath ? 'visible' : 'none');
    }
  }, [map, showHeatmap, show3DH3Grid, showActualPath]);

  // ── Server-side H3 Aggregation: fetch pre-computed cells ─────────────────
  // The backend /api/h3-aggregate endpoint:
  //   • Scans ALL rows in PostgreSQL (no sampling, no data loss)
  //   • Computes LatLngToCell(lat, lng, resolution) for every point in Go (O(1))
  //   • Aggregates per cell: count, avg_dev, avoid_trips, ratio, height
  //   • Returns center_lat/lng + cell_size_deg (frontend draws hexagon locally)
  // This is ~50-300x faster than shipping raw GPS points to the browser.
  //
  // FIX: moveend triggers a re-fetch with the updated viewport bbox.
  // Without this, panning after zoom would show blank hexagons because the
  // bbox hash changes (new area) but h3Resolution doesn't → useEffect doesn't re-run.
  const [viewportBbox, setViewportBbox] = useState(null);

  // Listen to moveend to update bbox and trigger re-fetch
  useEffect(() => {
    if (!map) return;

    const getBbox = () => {
      try {
        const b = map.getBounds();
        // toFixed(3) ≈ 100m snapping — fine enough to reuse cache when panning slightly
        // without triggering a new fetch on every micro-pan.
        // (toFixed(2) was 1.1km — too coarse, caused different positions to share same key)
        return {
          minLat: b.getSouth().toFixed(3),
          maxLat: b.getNorth().toFixed(3),
          minLng: b.getWest().toFixed(3),
          maxLng: b.getEast().toFixed(3),
        };
      } catch { return null; }
    };

    // Sync immediately on mount
    setViewportBbox(getBbox());

    let moveTimer = null;
    const onMoveEnd = () => {
      clearTimeout(moveTimer);
      // 400ms debounce — prevents backend spam during continuous pan/drag
      moveTimer = setTimeout(() => {
        setViewportBbox(getBbox());
      }, 400);
    };

    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
      clearTimeout(moveTimer);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    // historyFrom comes from /api/stats-summary data_from_ms — no hardcoded dates.
    // If not yet loaded (null), use epoch so backend returns full dataset.
    const fromMs = historyFrom || 0;

    // Cache invalidation when parent passes fresh points (new date range load)
    if (cachedPointsRef.current !== points) {
      h3GeoJSONCacheRef.current.clear();
      cachedPointsRef.current = points;
    }

    // Build bbox params — always send bbox to keep response fast.
    // We EXPAND the bbox by 100% in each direction (2x viewport size) so hexagons
    // near the viewport edge are included — prevents empty areas when panning.
    // At res <= 9 (city-wide), no bbox needed — response is already small.
    let bboxParams = '';
    let bboxHash = 'all';
    if (h3Resolution >= 10 && viewportBbox) {
      const { minLat, maxLat, minLng, maxLng } = viewportBbox;
      // Expand bbox by 150% padding each side
      const dLat = (parseFloat(maxLat) - parseFloat(minLat)) * 1.5;
      const dLng = (parseFloat(maxLng) - parseFloat(minLng)) * 1.5;
      let eLat1 = parseFloat(minLat) - dLat;
      let eLat2 = parseFloat(maxLat) + dLat;
      let eLng1 = parseFloat(minLng) - dLng;
      let eLng2 = parseFloat(maxLng) + dLng;

      // Adaptive minimum bbox per resolution — tuned by benchmark:
      //   res 10: 0.20° → ~22km, neighbourhood
      //   res 11: 0.10° → ~11km, street block
      //   res 12: 0.08° → ~8km,  intersection (~1000 cells)
      //   res 13: 0.01° → ~1km,  lane level (~4700 cells, 412ms)
      //   res 14: 0.006°→ ~600m, max detail (~3600 cells, 240ms)
      const MIN_DEG_BY_RES = {
        10: 0.20,
        11: 0.10,
        12: 0.08,
        13: 0.010,
        14: 0.006,
      };
      const MIN_DEG = MIN_DEG_BY_RES[h3Resolution] ?? 0.08;
      const centerLat = (eLat1 + eLat2) / 2;
      const centerLng = (eLng1 + eLng2) / 2;
      if ((eLat2 - eLat1) < MIN_DEG) {
        eLat1 = centerLat - MIN_DEG / 2;
        eLat2 = centerLat + MIN_DEG / 2;
      }
      if ((eLng2 - eLng1) < MIN_DEG) {
        eLng1 = centerLng - MIN_DEG / 2;
        eLng2 = centerLng + MIN_DEG / 2;
      }

      bboxParams = `&min_lat=${eLat1.toFixed(4)}&max_lat=${eLat2.toFixed(4)}&min_lng=${eLng1.toFixed(4)}&max_lng=${eLng2.toFixed(4)}`;
      // Cache key: viewport bbox at 3dp precision (100m grid)
      bboxHash = `${minLat}:${maxLat}:${minLng}:${maxLng}`;
    }


    // Cache key: resolution + viewport hash
    const cacheKey = `${h3Resolution}:${bboxHash}`;
    if (h3GeoJSONCacheRef.current.has(cacheKey)) {
      const cached = h3GeoJSONCacheRef.current.get(cacheKey);
      setH3GeoJSON(cached.h3GeoJSON);
      return;
    }

    // Cancel previous in-flight fetch (user zoomed/panned while fetching)
    if (viewportFetchAbortRef.current) {
      viewportFetchAbortRef.current.abort();
    }
    const controller = new AbortController();
    viewportFetchAbortRef.current = controller;

    const toParam = historyTo || (Date.now() + 86400000);
    const url = `${apiUrl}/api/h3-aggregate?from=${fromMs}&to=${toParam}&resolution=${h3Resolution}${bboxParams}`;

    // Fetch with exponential-backoff retry (handles backend startup race on npm run start)
    const fetchWithRetry = async (retries = 3, delayMs = 1000) => {
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.cells) return;
        // Do NOT cache or act on empty results:
        // An empty response means the expanded bbox happened to have no GPS data.
        // The user might pan slightly to an area that DOES have data — retrying is correct.
        // Caching empty would lock out nearby areas sharing the same cache key (100m grid).
        if (data.cells.length === 0) {
          // Still clear the current layer so stale hexagons from a previous area don't persist
          setH3GeoJSON({ type: 'FeatureCollection', features: [] });
          return; // Don't cache — allow retry on next moveend
        }

        // Build hexagon polygon from center_lat/lng + cell_size_deg.
        // Uses the pre-computed HEX_COS/HEX_SIN lookup table (7 angles, flat-top).
        // ~10ms for 22k cells on main thread — no Worker needed.
        const features = data.cells.map(cell => {
          const { center_lat: lat, center_lng: lng, cell_size } = cell;
          const radius = cell_size / 2;
          // Longitude scale factor: 1° lng is shorter at higher latitudes
          const lngScale = 1.0 / Math.cos(lat * Math.PI / 180);
          const coords = HEX_COS.map((cos, i) => [
            lng + radius * lngScale * cos,
            lat + radius * HEX_SIN[i],
          ]);
          return {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [coords] },
            properties: {
              cell:           cell.cell,
              center_lat:     lat,
              center_lng:     lng,
              count:          cell.count,
              unique_drivers: cell.unique_drivers,
              avoid_trips:    cell.avoid_trips,
              total_trips:    cell.total_trips,
              avg_dev:        cell.avg_dev,
              max_dev:        cell.max_dev,
              height:         cell.height,
              ratio:          cell.ratio,
            },
          };
        });

        const geojson = { type: 'FeatureCollection', features };

        // LRU cache: max 20 entries
        if (h3GeoJSONCacheRef.current.size >= 20) {
          const firstKey = h3GeoJSONCacheRef.current.keys().next().value;
          h3GeoJSONCacheRef.current.delete(firstKey);
        }
        h3GeoJSONCacheRef.current.set(cacheKey, { h3GeoJSON: geojson });
        setH3GeoJSON(geojson);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (retries > 0) {
          console.info(`[h3-aggregate] retry in ${delayMs}ms (${retries} left)…`);
          await new Promise(res => setTimeout(res, delayMs));
          return fetchWithRetry(retries - 1, delayMs * 2);
        }
        console.warn('[h3-aggregate] fetch failed after all retries:', err.message);
      }
    };

    fetchWithRetry();

    return () => { controller.abort(); };
  // map is required: without it, if initial h3Resolution===12 AND getBbox() returns null
  // on first mount, the effect would never fire (map isn't in deps → no re-run on map load).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, h3Resolution, viewportBbox, historyFrom, historyTo, apiUrl, points]);


  // ── 3D H3 Hexagon Extrusion Grid Layer (~1.5m radius, Res 14) ──────────────
  useEffect(() => {
    if (!map) return;

    const sourceId = 'hm-3d-h3-src';
    const layerId = 'hm-3d-h3-extrusion';

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
        await show3DH3CellPopup(map, e.lngLat, f, points);
      });

      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    } else {
      const src = map.getSource(sourceId);
      if (src) src.setData(h3GeoJSON);
    }

    // Only update layer visibility — camera is managed by the dedicated effect below
    if (map.getLayer(layerId)) {
      const shouldShow = show3DH3Grid;
      map.setLayoutProperty(layerId, 'visibility', shouldShow ? 'visible' : 'none');
    }
  }, [map, h3GeoJSON, show3DH3Grid]);


  // ── Camera animation — fires ONLY when a toggle changes, NOT on every data fetch ──
  // Root cause of the snap-back bug: easeTo was inside the h3GeoJSON data effect.
  // Every pan/zoom updates h3GeoJSON → re-ran the effect → forced bearing back to -18,
  // overriding any manual rotation the user had done with the mouse.
  const prev3DH3Ref = useRef(show3DH3Grid);
  const prevActualPathRef = useRef(showActualPath);
  useEffect(() => {
    if (!map) return;
    const h3Changed = prev3DH3Ref.current !== show3DH3Grid;
    const apChanged = prevActualPathRef.current !== showActualPath;
    prev3DH3Ref.current = show3DH3Grid;
    prevActualPathRef.current = showActualPath;
    // Skip if only data changed (neither toggle flipped)
    if (!h3Changed && !apChanged) return;
    if (show3DH3Grid || showActualPath) {
      map.easeTo({ pitch: 48, bearing: -18, duration: 1000 });
    } else {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [map, show3DH3Grid, showActualPath]);

  // ── Actual-path H3 Extrusion Layer ("Hex Tài Xế Đi") ────────────────────────────
  // actualPathH3GeoJSON is now computed by the Web Worker (see the dispatch
  // useEffect above) and stored in the `actualPathH3GeoJSON` state.
  // This comment block is intentionally left to mark where the useMemo was.

  useEffect(() => {
    if (!map) return;

    const sourceId = 'hm-3d-actual-src';
    const layerId = 'hm-3d-actual-extrusion';

    const addLayerAndSource = () => {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'geojson',
          data: actualPathH3GeoJSON,
          tolerance: 1.5,
          buffer: 0,
        });

        map.addLayer({
          id: layerId,
          type: 'fill-extrusion',
          source: sourceId,
          layout: { visibility: showActualPath ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': [
              'interpolate', ['linear'], ['get', 'ratio'],
              0.00, '#b39ddb',
              0.25, '#7e57c2',
              0.50, '#5e35b1',
              0.75, '#3949ab',
              1.00, '#1a237e',
            ],
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.85,
          },
        });

        map.on('click', layerId, (e) => {
          e.originalEvent.stopPropagation();
          if (!e.features?.length) return;
          const f = e.features[0].properties;
          const PopupClass = map._maplibregl?.Popup || window.maplibregl?.Popup;
          new PopupClass({ offset: 12, maxWidth: '280px', closeButton: true })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="font-family:Inter,system-ui,sans-serif;font-size:12.5px;color:#111;line-height:1.8">
                <div style="font-weight:800;font-size:14px;margin-bottom:8px;color:#4527a0">
                  Đường Tài Xế Không Theo Plan
                </div>
                <div style="font-size:11px;color:#666;margin-bottom:10px">
                  Mã Cell: <code style="background:#ede7f6;padding:2px 5px;border-radius:4px;color:#4527a0;font-weight:600">${f.h3Index}</code>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;background:#f3e5f5;padding:8px;border-radius:8px;text-align:center;margin-bottom:8px">
                  <div>
                    <div style="color:#777;font-size:9.5px;text-transform:uppercase">TỔNG CHUYẾN</div>
                    <div style="font-weight:800;font-size:15px;color:#1a237e">${f.uniqueTrips}</div>
                  </div>
                  <div>
                    <div style="color:#777;font-size:9.5px;text-transform:uppercase">TÀI XẾ</div>
                    <div style="font-weight:800;font-size:15px;color:#7b1fa2">${f.uniqueDrivers}</div>
                  </div>
                  <div>
                    <div style="color:#777;font-size:9.5px;text-transform:uppercase">ĐIỂM GPS</div>
                    <div style="font-weight:800;font-size:15px;color:#4527a0">${f.intensity}</div>
                  </div>
                </div>
                <div style="font-size:11px;color:#555;background:#fff;padding:6px 8px;border:1px solid #e0e0e0;border-radius:6px">
                  📍 Đây là đoạn đường tài xế <b>thực tế đã đi</b> thay vì<br/>tuyến OSRM đã vạch. Dùng để phân tích &amp; cải thiện route plan.
                </div>
              </div>
            `)
            .addTo(map);
        });

        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      }

      const src = map.getSource(sourceId);
      if (src) src.setData(actualPathH3GeoJSON);

      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', showActualPath ? 'visible' : 'none');
      }
    };

    if (!map.isStyleLoaded()) {
      const onIdle = () => {
        map.off('idle', onIdle);
        addLayerAndSource();
      };
      map.on('idle', onIdle);
      return () => map.off('idle', onIdle);
    } else {
      addLayerAndSource();
    }
  }, [map, actualPathH3GeoJSON, showActualPath, show3DH3Grid]);

  // ── Selected trip route overlay ───────────────────────────────────────────
  useEffect(() => {
    if (!map) return;

    // Cleanup previous trip layers
    ['trip-planned-case', 'trip-planned', 'trip-actual-case', 'trip-actual',
      'trip-overlap-case', 'trip-overlap', 'trip-pts', 'trip-markers',
    ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) { } });
    ['trip-planned-src', 'trip-actual-src', 'trip-pts-src',
      'trip-overlap-src', 'trip-markers-src',
    ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) { } });

    if (!selectedTrip) return;
    const { coords, matchedRoute, plannedRoute } = selectedTrip;
    if (!coords || coords.length < 2) return;

    const actualCoords = matchedRoute || coords;
    const plannedCoords = plannedRoute || [coords[0], coords[coords.length - 1]];

    // ── Overlap detection ────────────────────────────────────────────────────
    // For each point in actualCoords, check if it's within 25m of the planned route
    function ptSegDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      if (dx === 0 && dy === 0) {
        const ex = p[0] - a[0], ey = p[1] - a[1];
        return Math.sqrt(ex * ex + ey * ey) * 111320;
      }
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      const ex = p[0] - (a[0] + t * dx), ey = p[1] - (a[1] + t * dy);
      return Math.sqrt(ex * ex + ey * ey) * 111320; // rough meters
    }
    function minDistToRoute(pt, route) {
      let min = Infinity;
      for (let j = 0; j < route.length - 1; j++) {
        const d = ptSegDist(pt, route[j], route[j + 1]);
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
    map.addLayer({
      id: 'trip-planned-case', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#fff', 'line-width': 8, 'line-opacity': 0.15 },
    });
    map.addLayer({
      id: 'trip-planned', type: 'line', source: 'trip-planned-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#29b6f6', 'line-width': 4, 'line-dasharray': [5, 4], 'line-opacity': 0.9 },
    });

    // ── Actual route: orange ──────────────────────────────────────────────────
    map.addLayer({
      id: 'trip-actual-case', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000', 'line-width': 7, 'line-opacity': 0.35 },
    });
    map.addLayer({
      id: 'trip-actual', type: 'line', source: 'trip-actual-src',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff6b35', 'line-width': 4, 'line-opacity': 0.95 },
    });

    // ── Overlap segments: purple ──────────────────────────────────────────────
    if (overlapSegments.length > 0) {
      map.addLayer({
        id: 'trip-overlap-case', type: 'line', source: 'trip-overlap-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 9, 'line-opacity': 0.3 },
      });
      map.addLayer({
        id: 'trip-overlap', type: 'line', source: 'trip-overlap-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e040fb', 'line-width': 5, 'line-opacity': 1.0 },
      });
    }

    // ── Raw GPS dots (visible at zoom ≥ 13) ──────────────────────────────────
    map.addLayer({
      id: 'trip-pts', type: 'circle', source: 'trip-pts-src', minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 4],
        'circle-color': '#fff', 'circle-opacity': 0.65,
        'circle-stroke-width': 1.2, 'circle-stroke-color': '#ff6b35',
      },
    });

    // ── Start / End markers ───────────────────────────────────────────────────
    map.addLayer({
      id: 'trip-markers', type: 'circle', source: 'trip-markers-src',
      paint: {
        'circle-radius': 10,
        'circle-color': [
          'match', ['get', 'role'],
          'start', '#00e676',  // bright green = start
          'end', '#ff1744',  // bright red = end
          '#fff'
        ],
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
        'circle-opacity': 1.0,
      },
    });

    // Cursor changes
    map.on('mouseenter', 'trip-actual', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'trip-actual', () => { map.getCanvas().style.cursor = ''; });
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
      // Terminate Web Worker to free thread resources
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (!map || !initialized.current) return;
      if (clickHandler.current) map.off('click', clickHandler.current);
      ['hm-heat', 'hm-hover', 'hm-snapped-dots', 'hm-3d-h3-extrusion',
        'trip-planned-case', 'trip-planned', 'trip-actual-case', 'trip-actual',
        'trip-overlap-case', 'trip-overlap', 'trip-pts', 'trip-markers',
      ].forEach(id => { try { if (map.getLayer(id)) map.removeLayer(id); } catch (_) { } });
      ['hm-points', 'hm-snapped', 'hm-3d-h3-src',
        'trip-planned-src', 'trip-actual-src', 'trip-overlap-src',
        'trip-pts-src', 'trip-markers-src',
      ].forEach(id => { try { if (map.getSource(id)) map.removeSource(id); } catch (_) { } });
      initialized.current = false;
    };
  }, [map]);

  return null;
}

