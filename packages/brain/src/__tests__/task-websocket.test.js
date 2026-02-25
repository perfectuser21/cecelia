/**
 * Task WebSocket Integration Tests
 *
 * Tests that task status updates trigger WebSocket broadcasts
 *
 * Broadcast format (from websocket.js):
 *   { event: 'task:started', data: { taskId, runId, status, ... }, timestamp }
 *
 * Event types (from websocket.js WS_EVENTS):
 *   task:started, task:completed, task:failed, task:progress
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocket as WS } from 'ws';
import { createServer } from 'http';
import pool from '../db.js';
import websocketService from '../websocket.js';
import { updateTaskStatus, updateTaskProgress } from '../task-updater.js';

/**
 * Helper: close a WebSocket client and wait for it to finish
 */
function closeWs(ws) {
  if (!ws || ws.readyState === WS.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    ws.on('close', resolve);
    ws.close();
  });
}

/**
 * Helper: create a connected WebSocket that collects all messages.
 * Resolves once the welcome message has been received.
 * Usage:
 *   const { ws, nextMessage } = await createClient(port);
 *   // trigger something...
 *   const msg = await nextMessage(); // gets next non-welcome message
 */
async function createClient(port) {
  const ws = new WS(`ws://localhost:${port}/ws`);
  const messages = [];
  let waiters = [];

  // Register message handler BEFORE the connection completes
  // to avoid race conditions with the welcome message
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(msg);
    } else {
      messages.push(msg);
    }
  });

  // Wait for open
  await new Promise((resolve) => ws.on('open', resolve));

  // Consume the welcome message (it may already be in messages[])
  const welcome = messages.length > 0
    ? messages.shift()
    : await new Promise((resolve) => waiters.push(resolve));

  if (welcome.event !== 'connected') {
    throw new Error(`Expected welcome message, got: ${welcome.event}`);
  }

  // Return a nextMessage() function that pulls from buffer or waits
  function nextMessage(timeoutMs = 3000) {
    if (messages.length > 0) {
      return Promise.resolve(messages.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  return { ws, nextMessage };
}

describe('Task WebSocket Integration', () => {
  let httpServer;
  let clients = [];
  let serverPort;
  let testTaskId;

  beforeAll(async () => {
    const result = await pool.query(`
      INSERT INTO tasks (title, description, status, priority)
      VALUES ('Test WebSocket Task', 'Test task for WebSocket integration', 'queued', 'P2')
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterAll(async () => {
    if (testTaskId) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }
  });

  beforeEach(async () => {
    httpServer = createServer();
    await new Promise((resolve) => httpServer.listen(0, resolve));
    serverPort = httpServer.address().port;
    websocketService.initWebSocketServer(httpServer);
    clients = [];
  });

  afterEach(async () => {
    // Close all client WebSockets
    await Promise.all(clients.map(c => closeWs(c)));
    clients = [];

    await websocketService.shutdownWebSocketServer();
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
      httpServer = null;
    }
  });

  it('should broadcast task:started when status updated to in_progress', async () => {
    const { ws, nextMessage } = await createClient(serverPort);
    clients.push(ws);

    await updateTaskStatus(testTaskId, 'in_progress');
    const msg = await nextMessage();

    expect(msg.event).toBe('task:started');
    expect(msg.data.taskId).toBe(testTaskId);
    expect(msg.data.status).toBe('running');
    expect(msg.data.startedAt).toBeTruthy();
  });

  it('should broadcast task:completed when task is completed', async () => {
    const { ws, nextMessage } = await createClient(serverPort);
    clients.push(ws);

    await updateTaskStatus(testTaskId, 'completed');
    const msg = await nextMessage();

    expect(msg.event).toBe('task:completed');
    expect(msg.data.taskId).toBe(testTaskId);
    expect(msg.data.status).toBe('completed');
    expect(msg.data.completedAt).toBeTruthy();
  });

  it('should broadcast task:failed when task fails', async () => {
    const { ws, nextMessage } = await createClient(serverPort);
    clients.push(ws);

    await updateTaskStatus(testTaskId, 'failed', {
      payload: { error: 'Test error' }
    });
    const msg = await nextMessage();

    expect(msg.event).toBe('task:failed');
    expect(msg.data.taskId).toBe(testTaskId);
    expect(msg.data.status).toBe('failed');
    expect(msg.data.error).toBeTruthy();
  });

  it('should broadcast on progress update for in_progress task', async () => {
    // Set task to in_progress first (so broadcastTaskUpdate triggers task:started)
    await updateTaskStatus(testTaskId, 'in_progress');

    const { ws, nextMessage } = await createClient(serverPort);
    clients.push(ws);

    await updateTaskProgress(testTaskId, {
      current_step: 5,
      step_name: 'Writing code'
    });
    const msg = await nextMessage();

    expect(msg.event).toBe('task:started');
    expect(msg.data.taskId).toBe(testTaskId);
  });

  it('should include timestamp in broadcast', async () => {
    const { ws, nextMessage } = await createClient(serverPort);
    clients.push(ws);

    await updateTaskStatus(testTaskId, 'in_progress', {
      payload: { current_step: 3, agent: 'dev' }
    });
    const msg = await nextMessage();

    expect(msg.event).toBe('task:started');
    expect(msg.data).toHaveProperty('taskId');
    expect(msg.data).toHaveProperty('status');
    expect(msg.data).toHaveProperty('startedAt');
    expect(msg.timestamp).toBeTruthy();
  });

  it('should broadcast to all connected clients on task update', async () => {
    const c1 = await createClient(serverPort);
    const c2 = await createClient(serverPort);
    clients.push(c1.ws, c2.ws);

    await updateTaskStatus(testTaskId, 'in_progress');

    const [msg1, msg2] = await Promise.all([c1.nextMessage(), c2.nextMessage()]);

    expect(msg1.event).toBe('task:started');
    expect(msg1.data.taskId).toBe(testTaskId);
    expect(msg2.event).toBe('task:started');
    expect(msg2.data.taskId).toBe(testTaskId);
  });

  it('should not block database operation on broadcast failure', async () => {
    // No WebSocket clients connected — broadcast should not throw
    const result = await updateTaskStatus(testTaskId, 'in_progress');

    expect(result.success).toBe(true);
    expect(result.task).toBeTruthy();
    expect(result.task.status).toBe('in_progress');
  });
});
