import React, { useState } from 'react';
import MapContainer from './components/MapContainer';
import FilterPanel from './components/FilterPanel';
import StatsOverlay from './components/StatsOverlay';
import { useHeatmapStream } from './hooks/useHeatmapStream';

/**
 * App — Admin Heatmap Dashboard root component.
 *
 * Architecture:
 * - MapContainer: MapLibre base map + Deck.gl H3HexagonLayer
 * - FilterPanel: Toggle live/history view, time range selection
 * - StatsOverlay: Real-time KPIs (active drivers, deviations, cells)
 * - useHeatmapStream: WebSocket subscription for live heatmap updates
 *
 * Data flow:
 * 1. useHeatmapStream connects to ws://host/ws/admin
 * 2. Receives HeatmapUpdate JSON every 1 second
 * 3. Accumulates H3 cell data in state
 * 4. MapContainer renders cells using Deck.gl H3HexagonLayer
 * 5. FilterPanel allows switching between live and historical views
 */
export default function App() {
  const [viewMode, setViewMode] = useState('live'); // 'live' | 'history'
  const [timeRange, setTimeRange] = useState({ from: null, to: null });

  const wsUrl = import.meta.env.VITE_WS_URL?.replace('/ws/driver', '/ws/admin')
    || 'ws://localhost:8080/ws/admin';

  const { cells, stats, connectionStatus } = useHeatmapStream(wsUrl);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', fontFamily: 'Inter, sans-serif' }}>
      {/* Main map with heatmap overlay */}
      <MapContainer cells={cells} />

      {/* Stats overlay (top-right) */}
      <StatsOverlay stats={stats} connectionStatus={connectionStatus} />

      {/* Filter panel (bottom) */}
      <FilterPanel
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />
    </div>
  );
}
