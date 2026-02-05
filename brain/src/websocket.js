/**
 * WebSocket Server for Real-time Task Status Push
 *
 * Provides real-time updates for:
 * - Task status changes (created, started, progress, completed, failed)
 * - Executor resource status (available seats, active tasks)
 */

import { WebSocketServer, WebSocket } from 'ws';

let wss = null;

// Security: Maximum message size (1KB)
const MAX_MESSAGE_SIZE = 1024;

// Security: Allowed origins (for CORS-like protection)
const ALLOWED_ORIGINS = process.env.WS_ALLOWED_ORIGINS
  ? process.env.WS_ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5212', 'http://localhost:5211', 'https://dev-core.zenjoymedia.media', 'https://core.zenjoymedia.media'];

/**
 * Event types
 */
export const WS_EVENTS = {
  TASK_CREATED: 'task:created',
  TASK_STARTED: 'task:started',
  TASK_PROGRESS: 'task:progress',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  EXECUTOR_STATUS: 'executor:status',
  PING: 'ping',
  PONG: 'pong'
};

/**
 * Initialize WebSocket server
 * @param {import('http').Server} server - HTTP server instance
 */
export function initWebSocketServer(server) {
  if (wss) {
    console.warn('[WebSocket] Server already initialized');
    return wss;
  }

  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const origin = req.headers.origin || req.headers.referer;

    // Security: Origin validation
    if (origin && !ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))) {
      console.warn(`[WebSocket] Rejected connection from unauthorized origin: ${origin}`);
      ws.close(1008, 'Unauthorized origin');
      return;
    }

    console.log(`[WebSocket] Client connected from ${clientIp}`);

    // Send welcome message
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'connected',
        data: { message: 'Welcome to Cecelia Brain WebSocket', timestamp: new Date().toISOString() }
      }));
    }

    // Handle ping-pong for connection health
    ws.on('message', (message) => {
      // Security: Message size limit
      if (message.length > MAX_MESSAGE_SIZE) {
        console.warn(`[WebSocket] Message too large (${message.length} bytes), closing connection`);
        ws.close(1009, 'Message too large');
        return;
      }

      try {
        const data = JSON.parse(message.toString());
        if (data.event === WS_EVENTS.PING) {
          ws.send(JSON.stringify({ event: WS_EVENTS.PONG, timestamp: new Date().toISOString() }));
        }
      } catch (err) {
        console.error('[WebSocket] Invalid message from client:', err.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WebSocket] Client disconnected from ${clientIp}`);
    });

    ws.on('error', (err) => {
      console.error('[WebSocket] Client error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WebSocket] Server error:', err.message);
  });

  console.log('[WebSocket] Server initialized on path /ws');
  return wss;
}

/**
 * Broadcast message to all connected clients
 * @param {string} event - Event type
 * @param {object} data - Event data
 */
export function broadcast(event, data) {
  if (!wss) {
    console.warn('[WebSocket] Server not initialized, skipping broadcast');
    return;
  }

  const message = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString()
  });

  let successCount = 0;
  let failCount = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successCount++;
      } catch (err) {
        console.error('[WebSocket] Failed to send to client:', err.message);
        failCount++;
      }
    }
  });

  if (wss.clients.size > 0) {
    console.log(`[WebSocket] Broadcast ${event}: ${successCount} sent, ${failCount} failed (${wss.clients.size} total)`);
  }
}

/**
 * Get connected clients count
 * @returns {number}
 */
export function getConnectedClientsCount() {
  if (!wss) return 0;
  return wss.clients.size;
}

/**
 * Shutdown WebSocket server gracefully
 * @returns {Promise<void>}
 */
export function shutdownWebSocketServer() {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }

    console.log('[WebSocket] Shutting down...');

    // Close all client connections first
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(1001, 'Server shutting down');
      }
    });

    // Close the server
    wss.close(() => {
      console.log('[WebSocket] Server closed');
      wss = null;
      resolve();
    });
  });
}
