import React, { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import ToastNotification from './components/ToastNotification';
import { useHeatmapStream } from './hooks/useHeatmapStream';
import { useProgressiveData } from './hooks/useProgressiveData';
import { matchTripToRoads, getPlannedRoute, computeH3Overlap, computeAvoidanceRatio } from './utils/osrmRouting';

export default function App() {
  const [mode, setMode] = useState('history');

  const wsUrl  = import.meta.env.VITE_ADMIN_WS_URL || 'ws://localhost:8080/ws/admin';
  const apiUrl = import.meta.env.VITE_API_URL       || 'http://localhost:8080';

  // ── Live Realtime State ────────────────────────────────────────────────────
  const [liveTrips, setLiveTrips] = useState([]);
  const [toastNotification, setToastNotification] = useState(null);

  const handleNewTrip = useCallback((newTrip) => {
    setToastNotification({ id: Date.now(), trip: newTrip });
    setLiveTrips((prev) => {
      if (prev.some((t) => t.trip_id === newTrip.trip_id)) return prev;
      return [newTrip, ...prev];
    });
  }, []);

  const { cells: liveCells, stats: liveStats, connectionStatus, clearCells } =
    useHeatmapStream(wsUrl, mode === 'live', handleNewTrip);

  // Fetch live trips from backend (simulator trips table)
  const fetchLiveTrips = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/trips?limit=500`);
      if (res.ok) {
        const data = await res.json();
        setLiveTrips(data.trips || []);
      }
    } catch (err) {
      console.warn('[Fetch Live Trips Error]', err);
    }
  }, [apiUrl]);

  useEffect(() => { fetchLiveTrips(); }, [fetchLiveTrips]);

  // ── History Filter State ───────────────────────────────────────────────────
  // dateRange stores ISO datetime strings from the date-picker.
  // null means "use the full dataset range provided by the backend".
  const [dateRange, setDateRange]         = useState({ from: null, to: null });
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [selectedTrip, setSelectedTrip]   = useState(null);

  // Derive fromMs / toMs from the date-picker — null means let the backend decide.
  // This avoids any hardcoded dataset-specific timestamps.
  const fromMs = dateRange.from ? new Date(dateRange.from).getTime() : null;
  const toMs   = dateRange.to   ? new Date(dateRange.to).getTime()   : null;

  // ── Progressive Data Loading ───────────────────────────────────────────────
  const {
    stats,                          // Phase 1: full counts + actual date range from DB
    trips, tripsTotal, tripsLoading, tripsComplete,
    points, pointsLoadedCount, pointsComplete,
    isInitializing, error: dataError,
  } = useProgressiveData({
    apiUrl,
    fromMs,
    toMs,
    driverId: selectedDriverId,
    enabled: mode === 'history',
  });

  const handleSelectDriver = (driverId) => {
    setSelectedDriverId(driverId);
    if (driverId && mode !== 'history') {
      setMode('history');
      clearCells();
      setSelectedTrip(null);
    }
  };

  // ── Trip Selection ────────────────────────────────────────────────────────
  const handleSelectTrip = async (trip) => {
    if (!trip) { setSelectedTrip(null); return; }

    // Show loading state immediately
    const base = {
      trip_id:        trip.trip_id,
      driver_id:      trip.driver_id,
      driver_name:    trip.driver_name || trip.driver_id,
      avg_deviation:  trip.avg_deviation || 0,
      point_count:    trip.point_count   || 0,
      // Simulator-specific fields (null for Porto historical)
      distance_km:    trip.distance_km   ?? null,
      is_deviated:    trip.is_deviated   ?? null,
      coords:         [],
      matchedRoute:   null,
      plannedRoute:   null,
      avoidanceRatio: 0,
      osrmLoading:    true,
    };

    setSelectedTrip(base);

    try {
      let rawCoords = [];
      let finalActual = null;
      let finalPlanned = null;

      // ── Simulator trip (from /api/trips): has waypoints + actual_route embedded ──
      // Waypoints = GPS drawn path, actual_route = OSRM-matched path
      // Format: [[lng, lat], ...] arrays (already parsed by Go JSON)
      if (trip.waypoints && trip.waypoints.length >= 2) {
        // GPS drawn path — use as raw coords
        rawCoords = trip.waypoints.filter(c => Array.isArray(c) && c.length === 2);

        // actual_route from simulator is already OSRM-matched
        if (trip.actual_route && trip.actual_route.length >= 2) {
          finalActual = trip.actual_route.filter(c => Array.isArray(c) && c.length === 2);
        } else {
          finalActual = rawCoords;
        }

        // Planned route: origin → destination via OSRM
        const startPt = rawCoords[0];
        const endPt   = rawCoords[rawCoords.length - 1];
        finalPlanned = await getPlannedRoute([startPt, endPt]);
        if (!finalPlanned || finalPlanned.length < 2) finalPlanned = [startPt, endPt];

      } else {
        // ── Porto historical trip (from /api/trips-summary): fetch GPS from deviation_events ──
        const fromMs = trip.first_seen ? new Date(trip.first_seen).getTime() - 60000 : 0;
        const toMs   = trip.last_seen  ? new Date(trip.last_seen).getTime()  + 60000 : Date.now();
        const ptRes  = await fetch(
          `${apiUrl}/api/points?trip_id=${encodeURIComponent(trip.trip_id)}&from=${fromMs}&to=${toMs}`
        );
        const ptData = ptRes.ok ? await ptRes.json() : { points: [] };
        const pts    = ptData.points || [];

        rawCoords = pts.map(p => [p.lng, p.lat]).filter(c => c[0] && c[1]);

        // Fallback to start point only
        if (rawCoords.length === 0 && trip.start_lat && trip.start_lng) {
          rawCoords = [[trip.start_lng, trip.start_lat]];
        }

        if (rawCoords.length >= 2) {
          const matched = await matchTripToRoads(rawCoords);
          finalActual = matched || rawCoords;

          const startPt = rawCoords[0];
          const endPt   = rawCoords[rawCoords.length - 1];
          finalPlanned = await getPlannedRoute([startPt, endPt]);
          if (!finalPlanned || finalPlanned.length < 2) finalPlanned = [startPt, endPt];
        }
      }

      if (rawCoords.length < 2) {
        setSelectedTrip(prev => prev?.trip_id === trip.trip_id
          ? { ...prev, coords: rawCoords, osrmLoading: false }
          : prev
        );
        return;
      }

      let avoidanceRatio = 0;
      if (finalActual && finalPlanned && finalActual.length >= 2 && finalPlanned.length >= 2) {
        // Use distance-based sampling (accurate for short & long trips alike).
        // H3 cell overlap is unreliable for short trips (< 2 km) because
        // H3-10 cells (~65m) can encompass both the detour and the direct path.
        avoidanceRatio = computeAvoidanceRatio(finalActual, finalPlanned, 25);
      }

      setSelectedTrip(prev => prev?.trip_id === trip.trip_id
        ? { ...prev, coords: rawCoords, matchedRoute: finalActual, plannedRoute: finalPlanned, avoidanceRatio, osrmLoading: false }
        : prev
      );
    } catch (err) {
      console.warn('Trip detail lookup failed:', err);
      setSelectedTrip(prev => prev?.trip_id === trip.trip_id
        ? { ...prev, osrmLoading: false }
        : prev
      );
    }
  };



  // ── Active data slices ────────────────────────────────────────────────────
  const activePoints = mode === 'live' ? [] : points;

  // Stats overlay: history mode shows data from /api/stats-summary (always accurate).
  // Live mode shows WebSocket aggregates.
  const activeStats = mode === 'live'
    ? {
        totalDrivers:   liveStats.totalDrivers    || 0,
        totalDeviations: liveStats.totalDeviations || 0,
        hotCells:        liveCells.length,
      }
    : {
        totalDrivers:    stats.totalTrips,     // 9,944 trips (from deviation_events)
        totalDeviations: stats.totalPoints,    // 386,328 GPS points
        hotCells:        stats.totalDrivers,   // 411 unique drivers
        // Progress info (shown in background indicator)
        pointsLoaded: pointsLoadedCount,
        tripsLoaded:  trips.length,
        tripsTotal,
      };

  // historyFrom / historyTo for the HeatmapLayer (h3-aggregate calls).
  // Use DB-reported dates when available; fall back to null (backend uses epoch → now).
  const historyFrom = fromMs ?? stats.dataFromMs;
  const historyTo   = toMs   ?? stats.dataToMs;

  // Available drivers for the dropdown — derived from loaded trips (grows as pages arrive)
  const availableDrivers = Array.from(
    new Set([
      ...liveTrips.map(t => t.driver_id),
      ...trips.map(t => t.driver_id),
    ])
  ).filter(Boolean).sort();

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'Inter, sans-serif', background: '#0a0a1a' }}>
      <ToastNotification toast={toastNotification} onClose={() => setToastNotification(null)} />

      {/* Sidebar */}
      <FilterPanel
        mode={mode}
        onModeChange={m => { setMode(m); if (m === 'live') { clearCells(); setSelectedTrip(null); } }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onFetchHistory={(from, to) => setDateRange({ from: new Date(from).toISOString(), to: new Date(to).toISOString() })}
        historyLoading={isInitializing}
        connectionStatus={connectionStatus}
        trips={mode === 'history' ? trips : liveTrips}
        availableDrivers={availableDrivers}
        selectedTripId={selectedTrip?.trip_id}
        onSelectTrip={handleSelectTrip}
        selectedDriverId={selectedDriverId}
        onSelectDriver={handleSelectDriver}
      />

      {/* Map area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          points={activePoints}
          selectedTrip={selectedTrip}
          actualPathCells={[]}
          historyFrom={historyFrom}
          historyTo={historyTo}
          apiUrl={apiUrl}
        />

        {/* Phase 1 initializing overlay — blocks only until stats are loaded */}
        {isInitializing && (
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
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚡</div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>Đang tải thống kê...</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>Heatmap sẽ xuất hiện ngay</div>
            </div>
          </div>
        )}

        {/* Background loading progress indicator — non-blocking, bottom-right */}
        {mode === 'history' && !isInitializing && (!pointsComplete || !tripsComplete) && (
          <div style={{
            position: 'absolute', bottom: '90px', right: '16px',
            background: 'rgba(10,10,30,0.85)',
            border: '1px solid rgba(108,99,255,0.2)',
            borderRadius: '8px', padding: '7px 14px',
            color: '#888', fontSize: '11px', zIndex: 10,
            backdropFilter: 'blur(6px)',
            display: 'flex', flexDirection: 'column', gap: '3px',
          }}>
            {!pointsComplete && (
              <span>
                🔄 GPS: {pointsLoadedCount.toLocaleString()}
                {stats.totalPoints > 0 && ` / ${stats.totalPoints.toLocaleString()}`}
              </span>
            )}
            {!tripsComplete && (
              <span>
                📋 Trips: {trips.length.toLocaleString()}
                {tripsTotal > 0 && ` / ${tripsTotal.toLocaleString()}`}
              </span>
            )}
          </div>
        )}

        {/* Error banner */}
        {dataError && (
          <div style={{
            position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(255,60,60,0.15)', border: '1px solid rgba(255,60,60,0.4)',
            borderRadius: '8px', padding: '10px 20px', color: '#ffaaaa',
            fontSize: '12px', zIndex: 20,
          }}>
            ⚠️ {dataError}
          </div>
        )}

        {/* Trip detail banner */}
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
              <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '13px' }}>
                {selectedTrip.point_count || (selectedTrip.coords?.length ?? 0)}
              </div>
            </div>
            {/* Show distance for simulator trips, avg deviation for Porto historical */}
            {selectedTrip.distance_km != null ? (
              <div>
                <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Quãng đường</div>
                <div style={{ color: '#e0e0ff', fontWeight: 700, fontSize: '13px' }}>
                  {selectedTrip.distance_km.toFixed(2)} km
                </div>
              </div>
            ) : (
              <div>
                <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Deviation</div>
                <div style={{ color: '#ff6b35', fontWeight: 700, fontSize: '13px' }}>
                  {selectedTrip.avg_deviation > 0 ? `${(selectedTrip.avg_deviation / 1000).toFixed(1)} km` : '—'}
                </div>
              </div>
            )}
            <div>
              <div style={{ color: '#555', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tỷ lệ né tránh</div>
              <div style={{
                color: selectedTrip.avoidanceRatio > 50 ? '#ff2244' : selectedTrip.avoidanceRatio > 20 ? '#ff8800' : '#4caf50',
                fontWeight: 700, fontSize: '13px',
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
