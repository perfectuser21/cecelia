/**
 * useWebSocket - WebSocket hook with auto-reconnect (exponential backoff)
 *
 * Features:
 * - Auto-reconnect on disconnect (max 30s backoff)
 * - Message event callback
 * - Connection status tracking
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseWebSocketOptions {
  onMessage?: (event: MessageEvent) => void;
  enabled?: boolean;
}

export interface UseWebSocketResult {
  connected: boolean;
  send: (data: string) => void;
}

export function useWebSocket(
  url: string,
  options: UseWebSocketOptions = {}
): UseWebSocketResult {
  const { onMessage, enabled = true } = options;
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const mountedRef = useRef(true);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!enabled || !mountedRef.current) return;

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
        retryRef.current = 0;
      };

      ws.onmessage = (e) => {
        onMessageRef.current?.(e);
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000);
        retryRef.current++;
        setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch {
      const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000);
      retryRef.current++;
      setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    }
  }, [url, enabled]);

  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, enabled]);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  return { connected, send };
}
