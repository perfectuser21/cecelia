import { useEffect, useState, useCallback, useRef } from 'react';

// WebSocket events from backend
const WS_EVENTS = {
  TASK_CREATED: 'task:created',
  TASK_STARTED: 'task:started',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  EXECUTOR_STATUS: 'executor:status',
  CONNECTED: 'connected',
  PING: 'ping',
  PONG: 'pong',
};

export interface ExecutionStatus {
  taskId: string;
  runId: string;
  title: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  currentStep: number;
  stepName: string;
  progress: number;
  agent?: string;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'error' | 'warning';
  message: string;
}

interface WSMessage {
  event: string;
  data: any;
  timestamp: string;
}

export function useExecutionStatus() {
  const [executions, setExecutions] = useState<Map<string, ExecutionStatus>>(new Map());
  const [logs, setLogs] = useState<Map<string, LogEntry[]>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;

    // In development, connect to localhost:5221
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ws://localhost:5221/ws';
    }

    // In production, use the current host with appropriate port
    const port = import.meta.env.VITE_WS_PORT || '5221';
    return `${protocol}//${host}:${port}/ws`;
  }, []);

  const addLog = useCallback((runId: string, level: LogEntry['level'], message: string) => {
    setLogs((prev) => {
      const next = new Map(prev);
      const existing = next.get(runId) || [];
      next.set(runId, [
        ...existing,
        {
          timestamp: new Date(),
          level,
          message,
        },
      ]);
      return next;
    });
  }, []);

  const handleMessage = useCallback(
    (message: WSMessage) => {
      const { event, data, timestamp } = message;

      switch (event) {
        case WS_EVENTS.CONNECTED:
          console.log('[ExecutionStatus] Connected to WebSocket');
          addLog('system', 'info', 'Connected to execution status stream');
          break;

        case WS_EVENTS.TASK_CREATED:
          setExecutions((prev) => {
            const next = new Map(prev);
            next.set(data.id, {
              taskId: data.task_id || data.id,
              runId: data.id,
              title: data.title || 'Task',
              status: 'queued',
              currentStep: 0,
              stepName: 'Queued',
              progress: 0,
              agent: data.agent,
              startedAt: data.started_at ? new Date(data.started_at) : undefined,
            });
            return next;
          });
          addLog(data.id, 'info', `Task created: ${data.title || data.id}`);
          break;

        case WS_EVENTS.TASK_STARTED:
          setExecutions((prev) => {
            const next = new Map(prev);
            const existing = next.get(data.id);
            if (existing) {
              next.set(data.id, {
                ...existing,
                status: 'in_progress',
                startedAt: data.started_at ? new Date(data.started_at) : new Date(),
              });
            } else {
              next.set(data.id, {
                taskId: data.task_id || data.id,
                runId: data.id,
                title: data.title || 'Task',
                status: 'in_progress',
                currentStep: data.progress || 0,
                stepName: data.step_name || 'In Progress',
                progress: data.progress || 0,
                agent: data.agent,
                startedAt: data.started_at ? new Date(data.started_at) : new Date(),
              });
            }
            return next;
          });
          addLog(data.id, 'info', `Task started: ${data.agent || 'agent'}`);
          break;

        case WS_EVENTS.TASK_PROGRESS:
          setExecutions((prev) => {
            const next = new Map(prev);
            const existing = next.get(data.id);
            if (existing) {
              next.set(data.id, {
                ...existing,
                currentStep: data.current_step || data.progress || existing.currentStep,
                stepName: data.step_name || existing.stepName,
                progress: data.progress || existing.progress,
              });
            }
            return next;
          });
          if (data.step_name) {
            addLog(data.id, 'info', `Step ${data.current_step || ''}: ${data.step_name}`);
          }
          break;

        case WS_EVENTS.TASK_COMPLETED:
          setExecutions((prev) => {
            const next = new Map(prev);
            const existing = next.get(data.id);
            if (existing) {
              next.set(data.id, {
                ...existing,
                status: 'completed',
                progress: 100,
                completedAt: data.completed_at ? new Date(data.completed_at) : new Date(),
              });
            }
            return next;
          });
          addLog(data.id, 'info', 'Task completed successfully');
          break;

        case WS_EVENTS.TASK_FAILED:
          setExecutions((prev) => {
            const next = new Map(prev);
            const existing = next.get(data.id);
            if (existing) {
              next.set(data.id, {
                ...existing,
                status: 'failed',
                error: data.error,
                completedAt: data.completed_at ? new Date(data.completed_at) : new Date(),
              });
            }
            return next;
          });
          addLog(data.id, 'error', `Task failed: ${data.error || 'Unknown error'}`);
          break;

        case WS_EVENTS.PONG:
          // Connection is healthy
          break;

        default:
          console.log('[ExecutionStatus] Unknown event:', event);
      }
    },
    [addLog]
  );

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      console.log('[ExecutionStatus] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[ExecutionStatus] WebSocket connected');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error('[ExecutionStatus] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[ExecutionStatus] WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[ExecutionStatus] WebSocket closed');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(
            `[ExecutionStatus] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`
          );
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[ExecutionStatus] Failed to create WebSocket:', err);
      setIsConnected(false);
    }
  }, [getWebSocketUrl, handleMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const sendPing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event: WS_EVENTS.PING }));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Heartbeat ping every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      sendPing();
    }, 30000);

    return () => clearInterval(interval);
  }, [sendPing]);

  const activeExecutions = Array.from(executions.values()).filter(
    (exec) => exec.status === 'in_progress' || exec.status === 'queued'
  );

  const completedExecutions = Array.from(executions.values()).filter(
    (exec) => exec.status === 'completed' || exec.status === 'failed'
  );

  return {
    executions: Array.from(executions.values()),
    activeExecutions,
    completedExecutions,
    logs,
    isConnected,
    connect,
    disconnect,
  };
}
