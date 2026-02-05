/**
 * WebSocket Service
 *
 * Manages WebSocket connections and broadcasts task execution status updates
 * to all connected clients.
 */

import { WebSocketServer } from 'ws';

/**
 * WebSocket message structure
 * @typedef {Object} WSMessage
 * @property {'run_update'|'run_complete'|'run_failed'} type - Message type
 * @property {Object} data - Task execution data
 * @property {string} timestamp - ISO timestamp
 */

class WebSocketService {
  constructor() {
    /** @type {WebSocketServer|null} */
    this.wss = null;

    /** @type {Set<WebSocket>} */
    this.clients = new Set();
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   */
  init(server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      console.log(`[WS] Client connected from ${clientIp}`);

      this.clients.add(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connected',
        data: { message: 'Connected to Cecelia Brain' },
        timestamp: new Date().toISOString()
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected from ${clientIp}`);
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WS] Client error:', error.message);
        this.clients.delete(ws);
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          console.log('[WS] Received message:', data);

          // Echo back for testing
          this.sendToClient(ws, {
            type: 'echo',
            data,
            timestamp: new Date().toISOString()
          });
        } catch (err) {
          console.error('[WS] Invalid message format:', err.message);
        }
      });
    });

    console.log('[WS] WebSocket server initialized on /ws');
  }

  /**
   * Send message to a specific client
   * @param {WebSocket} ws - WebSocket connection
   * @param {WSMessage} message - Message to send
   */
  sendToClient(ws, message) {
    try {
      if (ws.readyState === 1) { // OPEN state
        ws.send(JSON.stringify(message));
      }
    } catch (err) {
      console.error('[WS] Failed to send to client:', err.message);
    }
  }

  /**
   * Broadcast message to all connected clients
   * @param {WSMessage} message - Message to broadcast
   */
  broadcast(message) {
    if (!message || !message.type) {
      console.error('[WS] Invalid message format for broadcast');
      return;
    }

    // Ensure timestamp is set
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }

    const messageStr = JSON.stringify(message);
    let successCount = 0;
    let failCount = 0;

    for (const client of this.clients) {
      try {
        if (client.readyState === 1) { // OPEN state
          client.send(messageStr);
          successCount++;
        } else {
          this.clients.delete(client);
        }
      } catch (err) {
        console.error('[WS] Failed to broadcast to client:', err.message);
        failCount++;
        this.clients.delete(client);
      }
    }

    if (successCount > 0 || failCount > 0) {
      console.log(`[WS] Broadcast ${message.type}: ${successCount} sent, ${failCount} failed`);
    }
  }

  /**
   * Broadcast run update
   * @param {Object} runData - Run execution data
   */
  broadcastRunUpdate(runData) {
    const messageType = runData.status === 'completed'
      ? 'run_complete'
      : runData.status === 'failed'
        ? 'run_failed'
        : 'run_update';

    this.broadcast({
      type: messageType,
      data: {
        id: runData.id,
        status: runData.status,
        progress: runData.progress,
        task_id: runData.task_id,
        agent: runData.agent,
        started_at: runData.started_at,
        completed_at: runData.completed_at,
        error: runData.error
      },
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get number of connected clients
   * @returns {number}
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Close all connections and shutdown
   */
  shutdown() {
    console.log('[WS] Shutting down WebSocket server...');

    for (const client of this.clients) {
      try {
        client.close();
      } catch (err) {
        console.error('[WS] Error closing client:', err.message);
      }
    }

    this.clients.clear();

    if (this.wss) {
      this.wss.close(() => {
        console.log('[WS] WebSocket server closed');
      });
    }
  }
}

// Singleton instance
const websocketService = new WebSocketService();

export default websocketService;
