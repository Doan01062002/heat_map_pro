import React, { useState, useEffect } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import { useHeatmapStream } from './hooks/useHeatmapStream';
import { matchTripToRoads, getPlannedRoute, computeH3Overlap } from './utils/osrmRouting';

const PORTO_FROM = 1372636800000; // 2013-07-01
const PORTO_TO = 1377907200000; // 2013-08-31

export default function App() {
  const [mode, setMode] = useState('history');

  const wsUrl = import.meta.env.VITE_ADMIN_WS_URL || 'ws://localhost:8080/ws/admin';
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

  // Live stream
  const { cells: liveCells, stats: liveStats, connectionStatus, clearCells } =
    useHeatmapStream(wsUrl, mode === 'live');

  // History data
  const [historyPoints, setHistoryPoints] = useState([]);
  const [historyTrips, setHistoryTrips] = useState([]);
  const [historyTrajectories, setHistoryTrajectories] = useState([]);
  const [historyStats, setHistoryStats] = useState({ totalPoints: 0, totalTrips: 0 });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dateRange, setDateRange] = useState({ from: null, to: null });

  // Selected trip for route detail
  const [selectedTrip, setSelectedTrip] = useState(null);

  const fetchHistory = async (fromMs, toMs) => {
    setHistoryLoading(true);
    setSelectedTrip(null);
    try {
      const [ptRes, trRes] = await Promise.all([
        fetch(`${apiUrl}/api/points?from=${fromMs}&to=${toMs}`),
        fetch(`${apiUrl}/api/trajectories?from=${fromMs}&to=${toMs}`),
      ]);
      const ptData = await ptRes.json();
      const trData = await trRes.json();

      setHistoryPoints(ptData.points || []);

      // Extract trips from GeoJSON features for the sidebar list
      const features = trData.geojson?.features || [];
      const trips = features.map(f => ({
        trip_id: f.properties.trip_id,
        driver_id: f.properties.driver_id,
        avg_deviation: f.properties.avg_deviation,
        point_count: f.properties.point_count,
        // Coords for map overlay
        coords: f.geometry.coordinates,
      }));
      setHistoryTrips(trips);
      setHistoryTrajectories(trips); // same structure, used by HeatmapLayer for line rendering
      setHistoryStats({ totalPoints: ptData.total || 0, totalTrips: trips.length });
    } catch (err) {
      console.error('History fetch failed:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const [fetchError, setFetchError] = useState(null);

  // Auto-load Porto data on mount — retry up to 3 times if backend not ready
  useEffect(() => {
    let retries = 0;
    const tryFetch = async () => {
      try {
        await fetchHistory(PORTO_FROM, PORTO_TO);
        setFetchError(null);
      } catch (err) {
        if (retries < 3) {
          retries++;
          setTimeout(tryFetch, 2000 * retries);
        } else {
          setFetchError('Không thể kết nối backend. Hãy refresh trang sau khi backend đã khởi động.');
        }
      }
    };
    tryFetch();
  }, []);


  // Handle trip selection — immediately show raw GPS, then upgrade to OSRM-matched route
  const handleSelectTrip = async (trip) => {
    if (!trip) { setSelectedTrip(null); return; }

    // Step 1: Show immediately with raw GPS (user sees route right away)
    const base = {
      trip_id: trip.trip_id,
      driver_id: trip.driver_id,
      avg_deviation: trip.avg_deviation,
      point_count: trip.point_count,
      coords: trip.coords,
      matchedRoute: null,   // loading
      plannedRoute: null,   // loading
      osrmLoading: true,
    };
    setSelectedTrip(base);

    // Step 2: Fetch OSRM map matching + planned route in parallel
    try {
      const [matched, planned] = await Promise.all([
        matchTripToRoads(trip.coords),
        getPlannedRoute(trip.coords),           // pass full coords for intermediate waypoints
      ]);

      const actualRoute = matched || trip.coords;
      const plannedRoute = planned || [trip.coords[0], trip.coords[trip.coords.length - 1]];

      let avoidanceRatio = 0;
      if (actualRoute && plannedRoute) {
        const { overlapRatio } = computeH3Overlap(actualRoute, plannedRoute, 10);
        avoidanceRatio = Math.max(0, Math.min(100, Math.round((1 - overlapRatio) * 100)));
      }

      setSelectedTrip(prev => prev?.trip_id === trip.trip_id
        ? {
          ...prev,
          matchedRoute: matched,
          plannedRoute: planned,
          avoidanceRatio,
          osrmLoading: false
        }
        : prev
      );
    } catch (err) {
      console.error('OSRM failed:', err);
      setSelectedTrip(prev => prev?.trip_id === trip.trip_id
        ? { ...prev, osrmLoading: false }
        : prev
      );
    }
  };

  const activePoints = mode === 'live' ? [] : historyPoints;
  const activeStats = mode === 'live'
    ? { totalDrivers: liveStats.totalDrivers, totalDeviations: liveStats.totalDeviations, hotCells: liveCells.length }
    : { totalDrivers: historyStats.totalTrips, totalDeviations: historyStats.totalPoints, hotCells: historyStats.totalTrips };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Inter, sans-serif', background: '#0a0a1a' }}>
      {/* Sidebar */}
      <FilterPanel
        mode={mode}
        onModeChange={m => { setMode(m); if (m === 'live') { clearCells(); setSelectedTrip(null); } }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onFetchHistory={fetchHistory}
        historyLoading={historyLoading}
        connectionStatus={connectionStatus}
        trips={mode === 'history' ? historyTrips : []}
        selectedTripId={selectedTrip?.trip_id}
        onSelectTrip={handleSelectTrip}
      />

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          points={activePoints}
          selectedTrip={selectedTrip}
        />

        {/* Loading overlay */}
        {historyLoading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', zIndex: 20,
          }}>
            <div style={{
              background: 'rgba(15,12,41,0.95)',
              border: '1px solid rgba(108,99,255,0.3)',
              borderRadius: '16px', padding: '28px 36px', textAlign: 'center', color: '#e0e0ff',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>Đang tải dữ liệu…</div>
            </div>
          </div>
        )}

        {/* No-data notice with reload button */}
        {!historyLoading && historyPoints.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            background: 'rgba(15,12,41,0.95)',
            border: '1px solid rgba(255,100,100,0.3)',
            borderRadius: '16px', padding: '28px 36px', textAlign: 'center', color: '#e0e0ff',
            zIndex: 20, minWidth: '280px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
            <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>Chưa có dữ liệu</div>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>
              {fetchError || 'Backend đang khởi động hoặc chưa có data.'}
            </div>
            <button
              onClick={() => fetchHistory(PORTO_FROM, PORTO_TO)}
              style={{
                padding: '10px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg,#6c63ff,#4834d4)', color: '#fff',
                fontSize: '14px', fontWeight: 700,
              }}
            >
              🔄 Tải lại dữ liệu
            </button>
          </div>
        )}

        {/* Trip detail banner when selected */}
        {selectedTrip && (
          <div style={{
            position: 'absolute', bottom: '24px', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(10,10,30,0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(108,99,255,0.3)',
            borderRadius: '14px', padding: '14px 24px',
            display: 'flex', gap: '20px', alignItems: 'center',
            zIndex: 10, boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
            maxWidth: '700px',
          }}>
            <div>
              <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Driver</div>
              <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '13px' }}>{selectedTrip.driver_id}</div>
            </div>
            <div>
              <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>GPS Points</div>
              <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '13px' }}>{selectedTrip.point_count}</div>
            </div>
            <div>
              <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Deviation</div>
              <div style={{ color: '#ff6b35', fontWeight: 700, fontSize: '13px' }}>
                {(selectedTrip.avg_deviation / 1000).toFixed(1)} km
              </div>
            </div>
            <div>
              <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tỷ lệ né tránh</div>
              <div style={{
                color: selectedTrip.avoidanceRatio > 50 ? '#ff2244' : selectedTrip.avoidanceRatio > 20 ? '#ff8800' : '#4caf50',
                fontWeight: 700,
                fontSize: '13px'
              }}>
                {selectedTrip.osrmLoading ? '…' : `${selectedTrip.avoidanceRatio ?? 0}%`}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '20px' }}>
              {selectedTrip.osrmLoading ? (
                <div style={{ color: '#666', fontSize: '11px' }}>⏳ Đang map matching…</div>
              ) : (
                <div style={{ fontSize: '11.5px', lineHeight: 2 }}>
                  <div>
                    <span style={{ color: '#29b6f6', marginRight: '6px' }}>━ ╌ ━</span>
                    <span style={{ color: '#aaa' }}>
                      {selectedTrip.plannedRoute ? 'Tuyến dự kiến (OSRM)' : 'Tuyến dự kiến (fallback)'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: '#ff6b35', marginRight: '6px' }}>━━━</span>
                    <span style={{ color: selectedTrip.matchedRoute ? '#4caf50' : '#ff9800' }}>
                      {selectedTrip.matchedRoute ? '✓ Đường thực tế (map matched)' : '⚠ Đường thực tế (raw GPS)'}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: '#e040fb', marginRight: '6px' }}>━━━</span>
                    <span style={{ color: '#aaa' }}>Đoạn trùng nhau</span>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '2px' }}>
                    <span>
                      <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#00e676', border: '2px solid #fff', verticalAlign: 'middle', marginRight: 4 }} />
                      <span style={{ color: '#aaa', fontSize: '10.5px' }}>Điểm đầu</span>
                    </span>
                    <span>
                      <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#ff1744', border: '2px solid #fff', verticalAlign: 'middle', marginRight: 4 }} />
                      <span style={{ color: '#aaa', fontSize: '10.5px' }}>Điểm cuối</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => setSelectedTrip(null)}
              style={{
                background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer',
                color: '#666', borderRadius: '6px', padding: '5px 12px', fontSize: '14px',
                marginLeft: '4px',
              }}
            >✕</button>
          </div>
        )}


        <StatsOverlay stats={activeStats} mode={mode} connectionStatus={connectionStatus} />
      </div>
    </div>
  );
}
