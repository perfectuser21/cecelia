/**
 * React Hook for real-time task status updates via WebSocket
 */

import { useState, useEffect, useCallback } from 'react';
import { websocketClient, WebSocketMessage } from '../api/websocket';

export interface Task {
  id: string;
  runId?: string;
  title?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  skill?: string;
  priority?: string;
  error?: string;
  result?: any;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  timestamp: string;
}

export interface ExecutorStatus {
  activeCount: number;
  availableSlots: number;
  maxConcurrent: number;
  timestamp: string;
}

export function useTaskStatus(taskId?: string) {
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [executorStatus, setExecutorStatus] = useState<ExecutorStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const handleMessage = useCallback((message: WebSocketMessage) => {
    const { event, data, timestamp } = message;

    switch (event) {
      case 'task:created':
        if (data.taskId && (!taskId || data.taskId === taskId)) {
          setTasks(prev => {
            const newTasks = new Map(prev);
            newTasks.set(data.taskId!, {
              id: data.taskId!,
              runId: data.runId,
              title: data.title,
              status: 'queued',
              skill: data.skill,
              priority: data.priority,
              timestamp
            });
            return newTasks;
          });
        }
        break;

      case 'task:started':
        if (data.taskId && (!taskId || data.taskId === taskId)) {
          setTasks(prev => {
            const newTasks = new Map(prev);
            const existing = newTasks.get(data.taskId!) || {} as Task;
            newTasks.set(data.taskId!, {
              ...existing,
              id: data.taskId!,
              runId: data.runId,
              status: 'in_progress',
              startedAt: data.startedAt,
              timestamp
            });
            return newTasks;
          });
        }
        break;

      case 'task:progress':
        if (data.taskId && (!taskId || data.taskId === taskId)) {
          setTasks(prev => {
            const newTasks = new Map(prev);
            const existing = newTasks.get(data.taskId!) || {} as Task;
            newTasks.set(data.taskId!, {
              ...existing,
              id: data.taskId!,
              progress: data.progress,
              timestamp
            });
            return newTasks;
          });
        }
        break;

      case 'task:completed':
        if (data.taskId && (!taskId || data.taskId === taskId)) {
          setTasks(prev => {
            const newTasks = new Map(prev);
            const existing = newTasks.get(data.taskId!) || {} as Task;
            newTasks.set(data.taskId!, {
              ...existing,
              id: data.taskId!,
              status: 'completed',
              result: data.result,
              completedAt: data.completedAt,
              timestamp
            });
            return newTasks;
          });
        }
        break;

      case 'task:failed':
        if (data.taskId && (!taskId || data.taskId === taskId)) {
          setTasks(prev => {
            const newTasks = new Map(prev);
            const existing = newTasks.get(data.taskId!) || {} as Task;
            newTasks.set(data.taskId!, {
              ...existing,
              id: data.taskId!,
              status: 'failed',
              error: data.error,
              failedAt: data.failedAt,
              timestamp
            });
            return newTasks;
          });
        }
        break;

      case 'executor:status':
        setExecutorStatus({
          activeCount: data.activeCount || 0,
          availableSlots: data.availableSlots || 0,
          maxConcurrent: data.maxConcurrent || 0,
          timestamp
        });
        break;

      case 'connected':
        setIsConnected(true);
        break;
    }
  }, [taskId]);

  useEffect(() => {
    // Connect to WebSocket
    websocketClient.connect();

    // Register message handler for all events
    websocketClient.on('*', handleMessage);

    // Check connection state
    const checkConnection = () => {
      const state = websocketClient.getConnectionState();
      setIsConnected(state === WebSocket.OPEN);
    };
    
    checkConnection();
    const intervalId = setInterval(checkConnection, 5000);

    // Cleanup
    return () => {
      websocketClient.off('*', handleMessage);
      clearInterval(intervalId);
      // Don't disconnect here - keep connection alive for other components
    };
  }, [handleMessage]);

  return {
    tasks: Array.from(tasks.values()),
    executorStatus,
    isConnected
  };
}
