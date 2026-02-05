/**
 * Task WebSocket Integration Tests
 *
 * Tests that task status updates trigger WebSocket broadcasts
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocket as MockWebSocket } from 'ws';
import { createServer } from 'http';
import pool from '../db.js';
import websocketService from '../websocket.js';
import { updateTaskStatus, updateTaskProgress } from '../task-updater.js';

describe('Task WebSocket Integration', () => {
  let httpServer;
  let clientWs;
  const TEST_PORT = 5298;
  let testTaskId;

  beforeAll(async () => {
    // Create a test task in database
    const result = await pool.query(`
      INSERT INTO tasks (title, description, status, priority)
      VALUES ('Test WebSocket Task', 'Test task for WebSocket integration', 'queued', 'P2')
      RETURNING id
    `);
    testTaskId = result.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test task
    if (testTaskId) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
    }
  });

  beforeEach(async () => {
    // Create HTTP server for testing
    httpServer = createServer();
    await new Promise((resolve) => {
      httpServer.listen(TEST_PORT, resolve);
    });

    // Initialize WebSocket service
    websocketService.init(httpServer);
  });

  afterEach(async () => {
    // Clean up
    if (clientWs) {
      clientWs.close();
      clientWs = null;
    }

    websocketService.shutdown();

    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close(resolve);
      });
    }
  });

  it('should broadcast when task status is updated to running', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    // Update task status
    await updateTaskStatus(testTaskId, 'in_progress');

    const message = await messagePromise;

    expect(message.type).toBe('run_update');
    expect(message.data.id).toBe(testTaskId);
    expect(message.data.status).toBe('in_progress');
  });

  it('should broadcast when task is completed', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    // Complete task
    await updateTaskStatus(testTaskId, 'completed');

    const message = await messagePromise;

    expect(message.type).toBe('run_complete');
    expect(message.data.id).toBe(testTaskId);
    expect(message.data.status).toBe('completed');
    expect(message.data.completed_at).toBeTruthy();
  });

  it('should broadcast when task fails', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    // Fail task
    await updateTaskStatus(testTaskId, 'failed', {
      payload: { error: 'Test error' }
    });

    const message = await messagePromise;

    expect(message.type).toBe('run_failed');
    expect(message.data.id).toBe(testTaskId);
    expect(message.data.status).toBe('failed');
  });

  it('should broadcast progress updates', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    // Update progress
    await updateTaskProgress(testTaskId, {
      current_step: 5,
      step_name: 'Writing code'
    });

    const message = await messagePromise;

    expect(message.type).toBe('run_update');
    expect(message.data.id).toBe(testTaskId);
    expect(message.data.progress).toBe(5);
  });

  it('should include complete task information in broadcast', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    // Update with complete payload
    await updateTaskStatus(testTaskId, 'in_progress', {
      payload: {
        current_step: 3,
        agent: 'dev'
      }
    });

    const message = await messagePromise;

    expect(message.data).toHaveProperty('id');
    expect(message.data).toHaveProperty('status');
    expect(message.data).toHaveProperty('task_id');
    expect(message.data).toHaveProperty('started_at');
    expect(message.data.agent).toBe('dev');
  });

  it('should broadcast to all connected clients on task update', async () => {
    const client1 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);
    const client2 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await Promise.all([
      new Promise((resolve) => client1.on('open', resolve)),
      new Promise((resolve) => client2.on('open', resolve))
    ]);

    // Skip welcome messages
    await Promise.all([
      new Promise((resolve) => client1.once('message', resolve)),
      new Promise((resolve) => client2.once('message', resolve))
    ]);

    const receivePromises = [
      new Promise((resolve) => {
        client1.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      }),
      new Promise((resolve) => {
        client2.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      })
    ];

    // Update task
    await updateTaskStatus(testTaskId, 'in_progress');

    const [msg1, msg2] = await Promise.all(receivePromises);

    expect(msg1.type).toBe('run_update');
    expect(msg1.data.id).toBe(testTaskId);
    expect(msg2.type).toBe('run_update');
    expect(msg2.data.id).toBe(testTaskId);

    client1.close();
    client2.close();
  });

  it('should not block database operation on broadcast failure', async () => {
    // Don't connect any WebSocket clients
    // The broadcast should complete even with no clients

    const result = await updateTaskStatus(testTaskId, 'in_progress');

    expect(result.success).toBe(true);
    expect(result.task).toBeTruthy();
    expect(result.task.status).toBe('in_progress');
  });
});
