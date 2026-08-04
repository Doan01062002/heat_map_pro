/**
 * useHeatmapStream — WebSocket hook for receiving real-time heatmap updates.
 *
 * Connects to ws://host/ws/admin and accumulates H3 cell data.
 * The backend pushes HeatmapUpdate JSON every 1 second.
 *
 * Returns:
 * - cells: Map<string, { h3_index, intensity, last_updated }> — current cell state
 * - stats: { totalDrivers, totalDeviations, cellCount }
 * - connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error'
 */
import { useEffect, useRef, useState, useCallback } from 'react';

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

// Cells older than this are faded out (5 minutes)
const CELL_TTL_MS = 5 * 60 * 1000;

export function useHeatmapStream(url) {
  const [cells, setCells] = useState(new Map());
  const [stats, setStats] = useState({
    totalDrivers: 0,
    totalDeviations: 0,
    cellCount: 0,
  });
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const wsRef = useRef(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);
  const reconnectTimerRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnectionStatus('connected');
      reconnectDelayRef.current = RECONNECT_DELAY_MS;
    };

    ws.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        applyUpdate(update);
      } catch (err) {
        console.error('[HeatmapStream] Parse error:', err);
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      wsRef.current = null;

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      setConnectionStatus('error');
    };

    wsRef.current = ws;
  }, [url]);

  const applyUpdate = useCallback((update) => {
    const now = Date.now();

    setCells((prevCells) => {
      const newCells = new Map(prevCells);

      // Apply incoming cell updates
      for (const cell of update.cells) {
        const existing = newCells.get(cell.h3_index);
        newCells.set(cell.h3_index, {
          h3_index: cell.h3_index,
          intensity: (existing?.intensity || 0) + cell.intensity,
          last_updated: cell.last_updated,
        });
      }

      // Expire old cells (older than 5 minutes)
      for (const [key, cell] of newCells) {
        if (now - cell.last_updated > CELL_TTL_MS) {
          newCells.delete(key);
        }
      }

      return newCells;
    });

    setStats({
      totalDrivers: update.total_drivers || 0,
      totalDeviations: update.total_deviations || 0,
      cellCount: update.cells?.length || 0,
    });
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { cells, stats, connectionStatus };
}
