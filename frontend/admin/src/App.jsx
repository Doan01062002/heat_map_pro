import React, { useState } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import { useHeatmapStream } from './hooks/useHeatmapStream';

/**
 * App — Admin Dashboard root component.
 *
 * Data flow:
 * 1. useHeatmapStream subscribes to WebSocket for live heatmap updates
 * 2. HeatmapLayer renders H3 hexagon cells on MapLibre via Deck.gl
 * 3. FilterPanel toggles live/history mode and date range
 * 4. StatsOverlay shows real-time KPIs
 */
export default function App() {
  const [mode, setMode] = useState('live'); // 'live' | 'history'
  const [dateRange, setDateRange] = useState({ from: null, to: null });

  const wsUrl = import.meta.env.VITE_ADMIN_WS_URL || 'ws://localhost:8080/ws/admin';
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';

  const {
    cells,
    stats,
    connectionStatus,
    clearCells,
  } = useHeatmapStream(wsUrl, mode === 'live');

  // History mode: fetch from REST API
  const [historyCells, setHistoryCells] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const handleFetchHistory = async (from, to) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/history?from=${from}&to=${to}`);
      const data = await res.json();
      setHistoryCells(data.cells || []);
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setHistoryCells([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const activeCells = mode === 'live' ? cells : historyCells;

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
          if (m === 'live') {
            setHistoryCells([]);
            clearCells();
          }
        }}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onFetchHistory={handleFetchHistory}
        historyLoading={historyLoading}
        connectionStatus={connectionStatus}
      />

      {/* Map Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer cells={activeCells} />

        {/* Stats Overlay */}
        <StatsOverlay
          stats={stats}
          cellCount={activeCells.length}
          mode={mode}
          connectionStatus={connectionStatus}
        />
      </div>
    </div>
  );
}
