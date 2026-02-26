/**
 * useCeceliaWS — Brain WebSocket event subscription hook
 *
 * Connects to /api/brain/ws and dispatches typed events
 * to registered callbacks. Replaces setInterval polling.
 */

import { useEffect, useRef, useCallback, useState } from 'react';

// Mirror of packages/brain/src/websocket.js WS_EVENTS
export const WS_EVENTS = {
  TASK_CREATED: 'task:created',
  TASK_STARTED: 'task:started',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  EXECUTOR_STATUS: 'executor:status',
  PROPOSAL_CREATED: 'proposal:created',
  PROPOSAL_RESOLVED: 'proposal:resolved',
  PROFILE_CHANGED: 'profile:changed',
  ALERTNESS_CHANGED: 'alertness:changed',
  DESIRE_CREATED: 'desire:created',
  DESIRE_UPDATED: 'desire:updated',
  DESIRE_EXPRESSED: 'desire:expressed',
  TICK_EXECUTED: 'tick:executed',
  PING: 'ping',
  PONG: 'pong',
} as const;

export type WSEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];

export interface WSMessage {
  event: WSEventType;
  data: any;
  timestamp: string;
}

type EventHandler = (data: any, timestamp: string) => void;

interface UseCeceliaWSResult {
  connected: boolean;
  subscribe: (event: WSEventType, handler: EventHandler) => () => void;
}

export function useCeceliaWS(): UseCeceliaWSResult {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const mountedRef = useRef(true);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/brain/ws`);

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setConnected(true);
        retryRef.current = 0;
      };

      ws.onmessage = (e) => {
        try {
          const msg: WSMessage = JSON.parse(e.data);
          if (msg.event === WS_EVENTS.PING) {
            ws.send(JSON.stringify({ event: WS_EVENTS.PONG }));
            return;
          }
          const handlers = handlersRef.current.get(msg.event);
          if (handlers) {
            handlers.forEach(h => h(msg.data, msg.timestamp));
          }
        } catch { /* ignore parse errors */ }
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

      ws.onerror = () => ws.close();

      wsRef.current = ws;
    } catch {
      const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000);
      retryRef.current++;
      setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const subscribe = useCallback((event: WSEventType, handler: EventHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => {
      handlersRef.current.get(event)?.delete(handler);
    };
  }, []);

  return { connected, subscribe };
}
