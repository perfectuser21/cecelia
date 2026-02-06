/**
 * WebSocket Service for Real-time Task Status Updates
 *
 * Provides a singleton WebSocket connection to the Brain server
 * for receiving real-time task status updates.
 */

export type WebSocketEventType =
  | 'task:created'
  | 'task:started'
  | 'task:progress'
  | 'task:completed'
  | 'task:failed'
  | 'executor:status'
  | 'connected'
  | 'ping'
  | 'pong';

export interface WebSocketMessage {
  event: WebSocketEventType;
  data: any;
  timestamp: string;
}

export interface TaskStatusData {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  task_id?: string;
  agent?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

export interface ExecutorStatusData {
  activeCount: number;
  availableSlots: number;
}

type EventCallback = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 3000;
  private listeners: Map<WebSocketEventType, Set<EventCallback>> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval = 30000; // 30 seconds
  private isIntentionallyClosed = false;

  /**
   * Connect to WebSocket server
   */
  connect(url?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    this.isIntentionallyClosed = false;

    // Determine WebSocket URL
    const wsUrl = url || this.getDefaultUrl();

    console.log(`[WebSocket] Connecting to ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
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
        this.stopHeartbeat();

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isIntentionallyClosed = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[WebSocket] Disconnected');
  }

  /**
   * Subscribe to a specific event
   */
  on(event: WebSocketEventType, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.delete(callback);
      }
    };
  }

  /**
   * Send a message to the server
   */
  send(event: WebSocketEventType, data?: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    } else {
      console.warn('[WebSocket] Cannot send message, not connected');
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // Private methods

  private getDefaultUrl(): string {
    // Use Brain port (5221 or 5212 depending on env)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;

    // Determine port based on current location
    const currentPort = window.location.port;
    let brainPort = '5221'; // Production default

    if (currentPort === '5212' || hostname.includes('dev-')) {
      brainPort = '5212'; // Dev environment
    }

    // If running locally (localhost), use the Brain port
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//${hostname}:${brainPort}/ws`;
    }

    // For production, use same host (proxied through Cloudflare Tunnel)
    return `${protocol}//${hostname}/ws`;
  }

  private handleMessage(message: WebSocketMessage): void {
    const callbacks = this.listeners.get(message.event);

    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(message.data);
        } catch (err) {
          console.error(`[WebSocket] Error in event callback for ${message.event}:`, err);
        }
      });
    }

    // Handle pong response
    if (message.event === 'pong') {
      // Heartbeat acknowledged
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('ping');
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
