import React, { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import ToastNotification from './components/ToastNotification';
import { useHeatmapStream } from './hooks/useHeatmapStream';
import { useProgressiveData } from './hooks/useProgressiveData';
import { matchTripToRoads, getPlannedRoute, computeH3Overlap } from './utils/osrmRouting';

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

    // Build coords from trip data — trip comes from /api/trips-summary (deviation_events aggregate)
    // coords are lat/lng pairs from the GPS path stored in deviation_events
    const rawCoords = [];
    if (trip.start_lat && trip.start_lng) {
      rawCoords.push([trip.start_lng, trip.start_lat]);
    }

    const base = {
      trip_id:        trip.trip_id,
      driver_id:      trip.driver_id,
      driver_name:    trip.driver_id,
      avg_deviation:  trip.avg_deviation || 0,
      point_count:    trip.point_count   || 0,
      coords:         rawCoords.length >= 2 ? rawCoords : [],
      matchedRoute:   null,
      plannedRoute:   null,
      avoidanceRatio: 0,
      osrmLoading:    rawCoords.length >= 2,
    };
    setSelectedTrip(base);

    if (rawCoords.length < 2) return;

    try {
      const startPt = rawCoords[0];
      const endPt   = rawCoords[rawCoords.length - 1];

      const matched = await matchTripToRoads(rawCoords);
      const finalActual = matched || rawCoords;

      let finalPlanned = await getPlannedRoute([startPt, endPt]);
      if (!finalPlanned || finalPlanned.length < 2) finalPlanned = [startPt, endPt];

      let avoidanceRatio = 0;
      if (finalActual && finalPlanned) {
        const { overlapRatio } = computeH3Overlap(finalActual, finalPlanned, 10);
        avoidanceRatio = Math.max(0, Math.min(100, Math.round((1 - overlapRatio) * 100)));
      }

      setSelectedTrip(prev => prev?.trip_id === trip.trip_id
        ? { ...prev, matchedRoute: finalActual, plannedRoute: finalPlanned, avoidanceRatio, osrmLoading: false }
        : prev
      );
    } catch (err) {
      console.warn('OSRM trip lookup failed:', err);
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
