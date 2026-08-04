import React, { useState, useEffect } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import { useHeatmapStream } from './hooks/useHeatmapStream';

/**
 * App — Admin Dashboard root component.
 *
 * Data flow:
 * - History mode: fetch raw GPS points + trajectories from REST API
 *   → MapContainer renders smooth road-following heatmap + trajectory lines
 * - Live mode: subscribe to WebSocket for real-time heatmap updates
 */

const PORTO_FROM = 1372636800000; // 2013-07-01
const PORTO_TO   = 1377907200000; // 2013-08-31

export default function App() {
  const [mode, setMode] = useState('history');

  const wsUrl  = import.meta.env.VITE_ADMIN_WS_URL || 'ws://localhost:8080/ws/admin';
  const apiUrl = import.meta.env.VITE_API_URL       || 'http://localhost:8080';

  // ── Live WebSocket stream ─────────────────────────────────────────────────
  const { cells: liveCells, stats: liveStats, connectionStatus, clearCells } =
    useHeatmapStream(wsUrl, mode === 'live');

  // ── History state ─────────────────────────────────────────────────────────
  const [historyPoints,      setHistoryPoints]      = useState([]);
  const [historyTrajectories, setHistoryTrajectories] = useState(null);
  const [historyStats,       setHistoryStats]       = useState({ totalPoints: 0, totalTrips: 0 });
  const [historyLoading,     setHistoryLoading]     = useState(false);
  const [dateRange,          setDateRange]          = useState({ from: null, to: null });

  const fetchHistory = async (fromMs, toMs) => {
    setHistoryLoading(true);
    try {
      // Fetch raw GPS points (up to 75 000 — full dataset)
      const [ptRes, trRes] = await Promise.all([
        fetch(`${apiUrl}/api/points?from=${fromMs}&to=${toMs}&limit=75000`),
        fetch(`${apiUrl}/api/trajectories?from=${fromMs}&to=${toMs}&limit=2000`),
      ]);

      const ptData = await ptRes.json();
      const trData = await trRes.json();

      setHistoryPoints(ptData.points || []);
      setHistoryTrajectories(trData.geojson || null);
      setHistoryStats({
        totalPoints: ptData.total || 0,
        totalTrips:  trData.total  || 0,
      });
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setHistoryPoints([]);
      setHistoryTrajectories(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Auto-load Porto taxi data on mount
  useEffect(() => {
    fetchHistory(PORTO_FROM, PORTO_TO);
  }, []);

  // ── Derive active data based on mode ────────────────────────────────────
  const activePoints       = mode === 'live' ? [] : historyPoints;
  const activeTrajectories = mode === 'live' ? null : historyTrajectories;
  const activeStats        = mode === 'live'
    ? { totalDrivers: liveStats.totalDrivers, totalDeviations: liveStats.totalDeviations, hotCells: liveCells.length }
    : { totalDrivers: historyStats.totalTrips, totalDeviations: historyStats.totalPoints, hotCells: historyStats.totalTrips };

  // Handler for FilterPanel "Fetch History" button
  const handleFetchHistory = (from, to) => fetchHistory(from, to);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      fontFamily: 'Inter, sans-serif',
      background: '#0a0a1a',
    }}>
      {/* Sidebar */}
      <FilterPanel
        mode={mode}
        onModeChange={(m) => {
          setMode(m);
          if (m === 'live') clearCells();
        }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onFetchHistory={handleFetchHistory}
        historyLoading={historyLoading}
        connectionStatus={connectionStatus}
      />

      {/* Map Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          points={activePoints}
          trajectories={activeTrajectories}
        />

        {/* Loading overlay */}
        {historyLoading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            zIndex: 20,
          }}>
            <div style={{
              background: 'rgba(15,12,41,0.95)',
              border: '1px solid rgba(108,99,255,0.3)',
              borderRadius: '16px',
              padding: '28px 36px',
              textAlign: 'center',
              color: '#e0e0ff',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>Loading trajectory data…</div>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                Fetching GPS points & trajectories
              </div>
            </div>
          </div>
        )}

        {/* Stats Overlay */}
        <StatsOverlay
          stats={activeStats}
          mode={mode}
          connectionStatus={connectionStatus}
        />
      </div>
    </div>
  );
}
