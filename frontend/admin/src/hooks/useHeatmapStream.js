import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useHeatmapStream — WebSocket hook for receiving live heatmap updates.
 *
 * Connects to the admin WebSocket endpoint. Accumulates cells with a
 * 5-minute TTL (stale cells are removed automatically).
 *
 * @param {string} url - WebSocket URL (ws://host:port/ws/admin)
 * @param {boolean} enabled - Whether to connect (false when in history mode)
 */
export function useHeatmapStream(url, enabled = true, onNewTrip = null) {
  const [cells, setCells] = useState([]);
  const [stats, setStats] = useState({
    totalDrivers: 0,
    totalDeviations: 0,
    serverTimestamp: 0,
  });
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  const wsRef = useRef(null);
  const cellMapRef = useRef(new Map()); // h3_index → cell data
  const reconnectTimerRef = useRef(null);

  const onNewTripRef = useRef(onNewTrip);
  useEffect(() => { onNewTripRef.current = onNewTrip; }, [onNewTrip]);

  const CELL_TTL_MS = 5 * 60 * 1000; // 5 minutes

  const clearCells = useCallback(() => {
    cellMapRef.current.clear();
    setCells([]);
    setStats({ totalDrivers: 0, totalDeviations: 0, serverTimestamp: 0 });
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnectionStatus('disconnected');
      return;
    }

    function connect() {
      setConnectionStatus('connecting');

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');
        console.log('[HeatmapStream] Connected to', url);
      };

      ws.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data);
          const now = Date.now();

          // Handle Realtime New Trip Event
          if (update.type === 'new_trip' && update.trip) {
            if (onNewTripRef.current) {
              onNewTripRef.current(update.trip);
            }
            return;
          }

          // Update stats
          setStats({
            totalDrivers: update.total_drivers || 0,
            totalDeviations: update.total_deviations || 0,
            serverTimestamp: update.server_timestamp || now,
          });

          // Merge new cells into cell map
          const cellMap = cellMapRef.current;
          if (update.cells && update.cells.length > 0) {
            for (const cell of update.cells) {
              const existing = cellMap.get(cell.h3_index);
              if (existing) {
                // Accumulate intensity
                cellMap.set(cell.h3_index, {
                  ...cell,
                  intensity: existing.intensity + cell.intensity,
                  last_updated: now,
                  _receivedAt: now,
                });
              } else {
                cellMap.set(cell.h3_index, {
                  ...cell,
                  last_updated: now,
                  _receivedAt: now,
                });
              }
            }
          }

          // Evict stale cells (older than TTL)
          for (const [key, val] of cellMap) {
            if (now - val._receivedAt > CELL_TTL_MS) {
              cellMap.delete(key);
            }
          }

          // Update React state
          setCells(Array.from(cellMap.values()));
        } catch (err) {
          console.error('[HeatmapStream] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // Auto-reconnect after 3 seconds
        if (enabled) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('[HeatmapStream] WebSocket error:', err);
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, enabled]);

  return { cells, stats, connectionStatus, clearCells };
}
