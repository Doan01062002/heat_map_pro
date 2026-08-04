import React, { useState, useCallback } from 'react';
import ControlPanel from './components/ControlPanel';
import MapView from './components/MapView';
import StatsBar from './components/StatsBar';
import { useWebSocket } from './hooks/useWebSocket';

/**
 * App — Driver Simulator root component.
 *
 * Architecture:
 * - ControlPanel: Configure driver count, deviation %, start/stop
 * - MapView: Visualize simulated driver positions on a map
 * - StatsBar: Display real-time stats (active drivers, GPS points sent, etc.)
 * - useWebSocket: Manages the WebSocket connection to the backend
 *
 * Data flow:
 * 1. User configures simulation parameters in ControlPanel
 * 2. Web Workers generate GPS traces for N drivers
 * 3. GPS batches are Protobuf-encoded and sent via WebSocket every 3s
 * 4. MapView shows current driver positions
 * 5. StatsBar shows send rate and connection status
 */
export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [driverCount, setDriverCount] = useState(100);
  const [deviationPercent, setDeviationPercent] = useState(20);
  const [stats, setStats] = useState({
    pointsSent: 0,
    batchesSent: 0,
    activeDrivers: 0,
  });

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/driver';
  const { connectionStatus, send } = useWebSocket(wsUrl);

  const handleStart = useCallback(() => {
    setIsRunning(true);
    // TODO: Initialize Web Workers for GPS generation
  }, [driverCount, deviationPercent]);

  const handleStop = useCallback(() => {
    setIsRunning(false);
    // TODO: Terminate Web Workers
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <StatsBar
        stats={stats}
        connectionStatus={connectionStatus}
        isRunning={isRunning}
      />
      <div style={{ display: 'flex', flex: 1 }}>
        <ControlPanel
          driverCount={driverCount}
          onDriverCountChange={setDriverCount}
          deviationPercent={deviationPercent}
          onDeviationPercentChange={setDeviationPercent}
          isRunning={isRunning}
          onStart={handleStart}
          onStop={handleStop}
        />
        <MapView
          isRunning={isRunning}
          driverCount={driverCount}
        />
      </div>
    </div>
  );
}
