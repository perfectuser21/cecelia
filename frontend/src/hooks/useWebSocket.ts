/**
 * React Hook for WebSocket Connection
 *
 * Provides easy access to WebSocket functionality in React components
 */

import { useEffect, useCallback } from 'react';
import { websocketService, type WebSocketEventType } from '../services/websocket.service';

/**
 * Hook to subscribe to WebSocket events
 *
 * @param event - Event type to listen for
 * @param callback - Callback function to handle the event
 * @param deps - Dependencies array for the callback (like useEffect)
 */
export function useWebSocketEvent(
  event: WebSocketEventType,
  callback: (data: any) => void,
  deps: React.DependencyList = []
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableCallback = useCallback(callback, deps);

  useEffect(() => {
    const unsubscribe = websocketService.on(event, stableCallback);

    return () => {
      unsubscribe();
    };
  }, [event, stableCallback]);
}

/**
 * Hook to manage WebSocket connection lifecycle
 *
 * Automatically connects when the component mounts and disconnects when it unmounts.
 *
 * @param autoConnect - Whether to automatically connect (default: true)
 */
export function useWebSocket(autoConnect = true): {
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  send: (event: WebSocketEventType, data?: any) => void;
} {
  useEffect(() => {
    if (autoConnect) {
      websocketService.connect();
    }

    return () => {
      if (autoConnect) {
        websocketService.disconnect();
      }
    };
  }, [autoConnect]);

  const connect = useCallback(() => {
    websocketService.connect();
  }, []);

  const disconnect = useCallback(() => {
    websocketService.disconnect();
  }, []);

  const send = useCallback((event: WebSocketEventType, data?: any) => {
    websocketService.send(event, data);
  }, []);

  return {
    connect,
    disconnect,
    isConnected: websocketService.isConnected(),
    send,
  };
}

/**
 * Hook to listen for task status updates
 *
 * @param taskId - Optional task ID to filter updates
 * @param onUpdate - Callback when task status changes
 */
export function useTaskStatus(
  onUpdate: (data: any) => void,
  taskId?: string
): void {
  const handleUpdate = useCallback((data: any) => {
    // Filter by task ID if provided
    if (taskId && data.task_id !== taskId && data.id !== taskId) {
      return;
    }

    onUpdate(data);
  }, [taskId, onUpdate]);

  // Listen to all task events
  useWebSocketEvent('task:created', handleUpdate, [handleUpdate]);
  useWebSocketEvent('task:started', handleUpdate, [handleUpdate]);
  useWebSocketEvent('task:progress', handleUpdate, [handleUpdate]);
  useWebSocketEvent('task:completed', handleUpdate, [handleUpdate]);
  useWebSocketEvent('task:failed', handleUpdate, [handleUpdate]);
}

/**
 * Hook to listen for executor status updates
 *
 * @param onUpdate - Callback when executor status changes
 */
export function useExecutorStatus(
  onUpdate: (data: { activeCount: number; availableSlots: number }) => void
): void {
  useWebSocketEvent('executor:status', onUpdate, [onUpdate]);
}
