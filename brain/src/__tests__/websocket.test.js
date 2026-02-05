/**
 * WebSocket Service Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket as MockWebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import websocketService from '../websocket.js';

describe('WebSocket Service', () => {
  let httpServer;
  let clientWs;
  const TEST_PORT = 5299;

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

  it('should start WebSocket server on /ws', () => {
    expect(websocketService.wss).not.toBeNull();
    expect(websocketService.wss.options.path).toBe('/ws');
  });

  it('should accept client connections', async () => {
    const connected = await new Promise((resolve, reject) => {
      clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

      clientWs.on('open', () => {
        resolve(true);
      });

      clientWs.on('error', (error) => {
        reject(error);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 2000);
    });

    expect(connected).toBe(true);
    expect(websocketService.getClientCount()).toBe(1);
  });

  it('should send welcome message on connection', async () => {
    const welcomeMessage = await new Promise((resolve, reject) => {
      clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

      clientWs.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          resolve(message);
        } catch (err) {
          reject(err);
        }
      });

      clientWs.on('error', reject);

      setTimeout(() => reject(new Error('No welcome message received')), 2000);
    });

    expect(welcomeMessage.type).toBe('connected');
    expect(welcomeMessage.data.message).toBe('Connected to Cecelia Brain');
    expect(welcomeMessage.timestamp).toBeTruthy();
  });

  it('should handle multiple clients', async () => {
    const client1 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);
    const client2 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await Promise.all([
      new Promise((resolve) => client1.on('open', resolve)),
      new Promise((resolve) => client2.on('open', resolve))
    ]);

    expect(websocketService.getClientCount()).toBe(2);

    client1.close();
    client2.close();
  });

  it('should cleanup on disconnect', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    expect(websocketService.getClientCount()).toBe(1);

    clientWs.close();

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(websocketService.getClientCount()).toBe(0);
  });

  it('should broadcast messages to all clients', async () => {
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

    const testMessage = {
      type: 'run_update',
      data: {
        id: 'test-123',
        status: 'running'
      }
    };

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

    websocketService.broadcast(testMessage);

    const [msg1, msg2] = await Promise.all(receivePromises);

    expect(msg1.type).toBe('run_update');
    expect(msg1.data.id).toBe('test-123');
    expect(msg2.type).toBe('run_update');
    expect(msg2.data.id).toBe('test-123');

    client1.close();
    client2.close();
  });

  it('should send valid message format', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const messagePromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    websocketService.broadcast({
      type: 'run_complete',
      data: {
        id: 'task-456',
        status: 'completed',
        progress: 11
      }
    });

    const message = await messagePromise;

    expect(message).toHaveProperty('type');
    expect(message).toHaveProperty('data');
    expect(message).toHaveProperty('timestamp');
    expect(message.type).toBe('run_complete');
    expect(message.data.id).toBe('task-456');
  });

  it('should isolate client errors', async () => {
    const client1 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);
    const client2 = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await Promise.all([
      new Promise((resolve) => client1.on('open', resolve)),
      new Promise((resolve) => client2.on('open', resolve))
    ]);

    expect(websocketService.getClientCount()).toBe(2);

    // Close client1 abruptly
    client1.terminate();

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Client2 should still work
    const messagePromise = new Promise((resolve) => {
      // Skip welcome message first
      let firstMessage = true;
      client2.on('message', (data) => {
        if (firstMessage) {
          firstMessage = false;
          return;
        }
        resolve(JSON.parse(data.toString()));
      });
    });

    websocketService.broadcast({
      type: 'run_update',
      data: { id: 'test', status: 'running' }
    });

    const message = await messagePromise;

    expect(message.type).toBe('run_update');

    client2.close();
  });

  it('should echo client messages', async () => {
    clientWs = new MockWebSocket(`ws://localhost:${TEST_PORT}/ws`);

    await new Promise((resolve) => clientWs.on('open', resolve));

    // Skip welcome message
    await new Promise((resolve) => clientWs.once('message', resolve));

    const echoPromise = new Promise((resolve) => {
      clientWs.once('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    clientWs.send(JSON.stringify({ test: 'hello' }));

    const echo = await echoPromise;

    expect(echo.type).toBe('echo');
    expect(echo.data.test).toBe('hello');
  });

  it('should have complete type definitions', () => {
    // Test that all required methods exist
    expect(typeof websocketService.init).toBe('function');
    expect(typeof websocketService.broadcast).toBe('function');
    expect(typeof websocketService.broadcastRunUpdate).toBe('function');
    expect(typeof websocketService.getClientCount).toBe('function');
    expect(typeof websocketService.shutdown).toBe('function');
  });
});
