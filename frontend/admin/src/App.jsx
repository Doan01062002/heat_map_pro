import React, { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import ToastNotification from './components/ToastNotification';
import { useHeatmapStream } from './hooks/useHeatmapStream';
import { matchTripToRoads, getPlannedRoute, computeH3Overlap } from './utils/osrmRouting';

const PORTO_FROM = 1372636800000; // 2013-07-01
const PORTO_TO = 1377907200000; // 2013-08-31

export default function App() {
  const [mode, setMode] = useState('history');

  const wsUrl = import.meta.env.VITE_ADMIN_WS_URL || 'ws://localhost:8080/ws/admin';
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

  // Live Realtime State
  const [liveTrips, setLiveTrips] = useState([]);
  const [toastNotification, setToastNotification] = useState(null);

  // Handle Realtime New Trip Event from WebSocket
  const handleNewTrip = useCallback((newTrip) => {
    console.log('[Admin Realtime] New trip received:', newTrip);
    setToastNotification({ id: Date.now(), trip: newTrip });

    setLiveTrips((prev) => {
      const exists = prev.some((t) => t.trip_id === newTrip.trip_id);
      if (exists) return prev;
      return [newTrip, ...prev];
    });
  }, []);

  // Live stream hook
  const { cells: liveCells, stats: liveStats, connectionStatus, clearCells } =
    useHeatmapStream(wsUrl, mode === 'live', handleNewTrip);

  // Fetch initial live trips from backend
  const fetchLiveTrips = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/trips?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setLiveTrips(data.trips || []);
      }
    } catch (err) {
      console.warn('[Fetch Live Trips Error]', err);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchLiveTrips();
  }, [fetchLiveTrips]);

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
      const fromParam = fromMs || PORTO_FROM;
      const toParam = (toMs && toMs !== PORTO_TO) ? toMs : Date.now() + 86400000;
      const [ptRes, trRes, tripsRes] = await Promise.all([
        fetch(`${apiUrl}/api/points?from=${fromParam}&to=${toParam}`),
        fetch(`${apiUrl}/api/trajectories?from=${fromParam}&to=${toParam}`),
        fetch(`${apiUrl}/api/trips?limit=100`),
      ]);
      const ptData = await ptRes.json();
      const trData = await trRes.json();
      const dbTripsData = await tripsRes.json();

      let allPoints = ptData.points || [];

      // Extract GPS points from DB trips actual_route for Heatmap & 3D H3 Grid rendering
      const dbTrips = dbTripsData.trips || [];
      dbTrips.forEach((t) => {
        let route = t.actual_route || t.actual_route_json;
        if (typeof route === 'string') {
          try { route = JSON.parse(route); } catch (_) { route = []; }
        }
        if (Array.isArray(route) && route.length > 0) {
          route.forEach(([lng, lat]) => {
            allPoints.push({
              lat,
              lng,
              deviation: t.is_deviated ? (t.deviation_meters || 250) : 15,
              trip_id: t.trip_id,
              created_at: t.created_at,
            });
          });
        }
      });

      setHistoryPoints(allPoints);

      const features = trData.geojson?.features || [];
      const trajTrips = features.map(f => ({
        trip_id: f.properties.trip_id,
        driver_id: f.properties.driver_id,
        avg_deviation: f.properties.avg_deviation,
        point_count: f.properties.point_count,
        coords: f.geometry.coordinates,
      }));

      // Combine trajectories with DB saved trips
      const combinedTrips = [...dbTrips];
      trajTrips.forEach(tt => {
        if (!combinedTrips.some(dt => dt.trip_id === tt.trip_id)) {
          combinedTrips.push(tt);
        }
      });

      setHistoryTrips(combinedTrips);
      setHistoryTrajectories(combinedTrips);
      setHistoryStats({ totalPoints: allPoints.length, totalTrips: combinedTrips.length });
    } catch (err) {
      console.error('History fetch failed:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const [fetchError, setFetchError] = useState(null);

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

  const handleSelectTrip = async (trip) => {
    if (!trip) { setSelectedTrip(null); return; }

    let actualRoute = trip.actual_route || trip.coords || [];
    if (typeof actualRoute === 'string') {
      try { actualRoute = JSON.parse(actualRoute); } catch (_) { actualRoute = []; }
    }

    let plannedRoute = trip.waypoints || [];
    if (typeof plannedRoute === 'string') {
      try { plannedRoute = JSON.parse(plannedRoute); } catch (_) { plannedRoute = []; }
    }

    // Fallback if actualRoute missing
    if ((!actualRoute || actualRoute.length < 2) && plannedRoute.length >= 2) {
      actualRoute = plannedRoute;
    }

    if ((!actualRoute || actualRoute.length < 2) && trip.origin && trip.destination) {
      const origLat = trip.origin.lat || trip.origin.latitude;
      const origLng = trip.origin.lng || trip.origin.longitude;
      const destLat = trip.destination.lat || trip.destination.latitude;
      const destLng = trip.destination.lng || trip.destination.longitude;
      if (origLat && origLng && destLat && destLng) {
        actualRoute = [[origLng, origLat], [destLng, destLat]];
      }
    }

    const rawCoords = actualRoute;

    // Base state with initial routes
    const base = {
      trip_id: trip.trip_id,
      driver_id: trip.driver_id,
      driver_name: trip.driver_name || trip.driver_id,
      avg_deviation: trip.avg_deviation || (trip.is_deviated ? 1500 : 0),
      point_count: trip.point_count || rawCoords.length,
      coords: rawCoords,
      matchedRoute: actualRoute.length >= 2 ? actualRoute : null,
      plannedRoute: plannedRoute.length >= 2 ? plannedRoute : null,
      avoidanceRatio: 0,
      osrmLoading: true,
    };
    setSelectedTrip(base);

    if (rawCoords.length >= 2) {
      try {
        const startPt = rawCoords[0];
        const endPt = rawCoords[rawCoords.length - 1];

        // 1. Match actual route to road network
        const matched = await matchTripToRoads(rawCoords);
        const finalActual = matched || actualRoute;

        // 2. Compute true planned route between ONLY startPt and endPt if plannedRoute isn't detailed
        let finalPlanned = plannedRoute;
        if (!finalPlanned || finalPlanned.length < 2) {
          finalPlanned = await getPlannedRoute([startPt, endPt]);
        }
        if (!finalPlanned || finalPlanned.length < 2) {
          finalPlanned = [startPt, endPt];
        }

        // 3. Compute avoidance ratio using H3 hexagon cell overlap
        let avoidanceRatio = 0;
        if (finalActual && finalPlanned) {
          const { overlapRatio } = computeH3Overlap(finalActual, finalPlanned, 10);
          avoidanceRatio = Math.max(0, Math.min(100, Math.round((1 - overlapRatio) * 100)));
        }

        setSelectedTrip(prev => prev?.trip_id === trip.trip_id
          ? {
            ...prev,
            matchedRoute: finalActual,
            plannedRoute: finalPlanned,
            avoidanceRatio,
            osrmLoading: false
          }
          : prev
        );
      } catch (err) {
        console.warn('OSRM trip lookup failed:', err);
        setSelectedTrip(prev => prev?.trip_id === trip.trip_id
          ? { ...prev, osrmLoading: false }
          : prev
        );
      }
    }
  };

  const activePoints = mode === 'live' ? [] : historyPoints;
  const activeStats = mode === 'live'
    ? { totalDrivers: liveStats.totalDrivers, totalDeviations: liveStats.totalDeviations, hotCells: liveCells.length }
    : { totalDrivers: historyStats.totalTrips, totalDeviations: historyStats.totalPoints, hotCells: historyStats.totalTrips };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', background: '#0a0a1a' }}>
      {/* Realtime Toast Notification */}
      <ToastNotification
        toast={toastNotification}
        onClose={() => setToastNotification(null)}
      />

      {/* Sidebar */}
      <FilterPanel
        mode={mode}
        onModeChange={m => { setMode(m); if (m === 'live') { clearCells(); setSelectedTrip(null); } }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onFetchHistory={fetchHistory}
        historyLoading={historyLoading}
        connectionStatus={connectionStatus}
        trips={mode === 'history' ? historyTrips : liveTrips}
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
              <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '13px' }}>{selectedTrip.driver_name || selectedTrip.driver_id}</div>
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
