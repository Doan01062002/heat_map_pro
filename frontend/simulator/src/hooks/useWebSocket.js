/**
 * useWebSocket — Shared WebSocket hook for Protobuf binary communication.
 *
 * Features:
 * - Auto-reconnect with exponential backoff (2s → 30s max)
 * - Binary message support (for Protobuf)
 * - Connection status tracking
 *
 * Usage:
 *   const { connectionStatus, send } = useWebSocket('ws://localhost:8080/ws/driver');
 *   send(protobufEncodedBuffer);
 */
import { useEffect, useRef, useState, useCallback } from 'react';

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

/**
 * @param {string} url - WebSocket URL
 * @returns {{ connectionStatus: string, send: (data: ArrayBuffer) => void }}
 */
export function useWebSocket(url) {
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
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnectionStatus('connected');
      reconnectDelayRef.current = RECONNECT_DELAY_MS; // Reset backoff
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      wsRef.current = null;

      // Schedule reconnect with exponential backoff
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);

      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (event) => {
      console.error('[WebSocket] Error:', event);
      setConnectionStatus('error');
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  return { connectionStatus, send };
}
