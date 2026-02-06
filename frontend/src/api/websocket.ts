/**
 * WebSocket Client Service
 * Provides real-time updates for task status changes
 */

export interface WebSocketMessage {
  event: string;
  data: {
    taskId?: string;
    runId?: string;
    status?: 'queued' | 'in_progress' | 'completed' | 'failed';
    progress?: number;
    title?: string;
    skill?: string;
    priority?: string;
    activeCount?: number;
    availableSlots?: number;
    maxConcurrent?: number;
    error?: string;
    result?: any;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
  };
  timestamp: string;
}

export type WebSocketEventHandler = (message: WebSocketMessage) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly reconnectDelay = 3000;
  private readonly pingInterval = 30000;
  private pingTimer: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Set<WebSocketEventHandler>> = new Map();
  private url: string;
  private isIntentionallyClosed = false;

  constructor() {
    // Determine WebSocket URL from current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = import.meta.env.VITE_BRAIN_PORT || '5221';
    
    // Use same host but Brain port for WebSocket
    this.url = `${protocol}//${host}:${port}/ws`;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isIntentionallyClosed = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to', this.url);
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Connection closed');
        this.stopPing();
        
        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WebSocket] Connection error:', err);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.isIntentionallyClosed = true;
    this.stopPing();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isIntentionallyClosed) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[WebSocket] Reconnecting...');
      this.connect();
    }, this.reconnectDelay);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event: 'ping' }));
      }
    }, this.pingInterval);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(message: WebSocketMessage) {
    // Ignore ping/pong
    if (message.event === 'pong' || message.event === 'ping') {
      return;
    }

    // Call event-specific handlers
    const handlers = this.eventHandlers.get(message.event);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }

    // Call wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach(handler => handler(message));
    }
  }

  on(event: string, handler: WebSocketEventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: WebSocketEventHandler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  getConnectionState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}

// Singleton instance
export const websocketClient = new WebSocketClient();
