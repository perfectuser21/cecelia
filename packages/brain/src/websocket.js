/**
 * WebSocket Server for Real-time Task Status Push
 *
 * Provides real-time updates for:
 * - Task status changes (created, started, progress, completed, failed)
 * - Executor resource status (available seats, active tasks)
 */

import { WebSocketServer, WebSocket } from 'ws';

let wss = null;
let heartbeatInterval = null;

// Security: Maximum message size (1KB)
const MAX_MESSAGE_SIZE = 1024;

// Server-side heartbeat: ping every 30s, terminate if no pong within 60s
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 60000;

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
  PONG: 'pong',
  // Proposal / Inbox 事件
  PROPOSAL_CREATED: 'proposal:created',
  PROPOSAL_COMMENT: 'proposal:comment',
  PROPOSAL_RESOLVED: 'proposal:resolved',
  // Model Profile 事件
  PROFILE_CHANGED: 'profile:changed',
  // Alertness 事件
  ALERTNESS_CHANGED: 'alertness:changed',
  // Desire 事件
  DESIRE_CREATED: 'desire:created',
  DESIRE_UPDATED: 'desire:updated',
  DESIRE_EXPRESSED: 'desire:expressed',
  // Tick 事件
  TICK_EXECUTED: 'tick:executed',
  // 认知状态事件（活性信号）
  COGNITIVE_STATE: 'cognitive:state',
  // Cecelia 主动推送消息（叙事/情绪变化）
  CECELIA_MESSAGE: 'cecelia:message',
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

    // Mark connection as alive for server-side heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

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

  // Server-side heartbeat: detect and clean up zombie connections
  heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('[WebSocket] Terminating zombie connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up interval when server closes
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
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

    // Stop heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

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

/**
 * Broadcast run/task update to all connected clients
 * Maps run data to WebSocket event format
 * @param {Object} update - Run update data
 * @param {string} update.id - Run/Task ID
 * @param {string} update.status - Status (queued, in_progress, completed, failed)
 * @param {number} update.progress - Progress percentage (0-100)
 * @param {string} update.task_id - Task ID
 * @param {string} update.agent - Agent name
 * @param {string} update.started_at - ISO timestamp
 * @param {string} update.completed_at - ISO timestamp
 * @param {string} update.error - Error message (if any)
 */
export function broadcastRunUpdate(update) {
  // Map status to WebSocket event type
  const statusToEvent = {
    'queued': WS_EVENTS.TASK_CREATED,
    'in_progress': WS_EVENTS.TASK_STARTED,
    'completed': WS_EVENTS.TASK_COMPLETED,
    'failed': WS_EVENTS.TASK_FAILED
  };

  const event = statusToEvent[update.status] || WS_EVENTS.TASK_PROGRESS;

  // Broadcast with standardized data format
  broadcast(event, {
    id: update.id,
    task_id: update.task_id,
    status: update.status,
    progress: update.progress || 0,
    agent: update.agent,
    started_at: update.started_at,
    completed_at: update.completed_at,
    error: update.error
  });
}

// Constants exported for testing
export { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS };

// Default export for convenience
export default {
  initWebSocketServer,
  broadcast,
  broadcastRunUpdate,
  getConnectedClientsCount,
  shutdownWebSocketServer,
  WS_EVENTS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS
};
