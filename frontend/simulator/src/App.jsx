import React, { useState, useCallback, useRef, useEffect } from 'react';
import ControlPanel from './components/ControlPanel';
import MapView from './components/MapView';
import StatsBar from './components/StatsBar';
import { useWebSocket } from './hooks/useWebSocket';

/**
 * App — Driver Simulator root component.
 *
 * Data flow:
 * 1. User configures simulation in ControlPanel → start/stop
 * 2. Web Worker generates GPS traces for N drivers (separate thread)
 * 3. Worker posts JSON GPSBatch → main thread sends via WebSocket
 * 4. MapView renders current driver positions
 * 5. StatsBar shows send rate and connection status
 */
export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [driverCount, setDriverCount] = useState(100);
  const [deviationPercent, setDeviationPercent] = useState(20);
  const [driverPositions, setDriverPositions] = useState([]);
  const [stats, setStats] = useState({
    pointsSent: 0,
    batchesSent: 0,
    activeDrivers: 0,
  });

  const workerRef = useRef(null);

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws/driver';
  const { connectionStatus, send } = useWebSocket(wsUrl);

  // Keep send ref stable for worker callback
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  const handleStart = useCallback(() => {
    // Create Web Worker
    const worker = new Worker(
      new URL('./workers/driverWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event) => {
      const msg = event.data;

      switch (msg.type) {
        case 'batch':
          // Send JSON batch to backend via WebSocket
          if (sendRef.current) {
            sendRef.current(msg.data);
          }
          break;

        case 'stats':
          setStats((prev) => ({
            pointsSent: prev.pointsSent + msg.pointsGenerated,
            batchesSent: msg.batchNumber,
            activeDrivers: msg.drivers.length,
          }));
          // Update driver positions for map
          setDriverPositions(msg.drivers);
          break;

        case 'started':
          console.log(`[Simulator] Started ${msg.driverCount} drivers, ${msg.deviationPercent}% deviating`);
          break;

        case 'stopped':
          console.log('[Simulator] Stopped');
          break;

        default:
          break;
      }
    };

    worker.onerror = (err) => {
      console.error('[Worker Error]', err);
    };

    // Start simulation
    worker.postMessage({
      type: 'start',
      driverCount,
      deviationPercent,
    });

    workerRef.current = worker;
    setIsRunning(true);
  }, [driverCount, deviationPercent]);

  const handleStop = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'stop' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsRunning(false);
    setDriverPositions([]);
    setStats({ pointsSent: 0, batchesSent: 0, activeDrivers: 0 });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
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
          connectionStatus={connectionStatus}
        />
        <MapView
          isRunning={isRunning}
          driverCount={driverCount}
          driverPositions={driverPositions}
        />
      </div>
    </div>
  );
}
