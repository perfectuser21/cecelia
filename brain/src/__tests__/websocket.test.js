/**
 * WebSocket Service Tests
 *
 * Tests WebSocket server initialization, connection management,
 * and message broadcasting functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'http';
import websocketService from '../websocket.js';

describe('WebSocket Service', () => {
  let server;
  let wsUrl;

  beforeEach(async () => {
    // Create HTTP server for testing
    server = createServer();
    await new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        wsUrl = `ws://localhost:${port}/ws`;
        resolve();
      });
    });

    // Initialize WebSocket service
    websocketService.init(server);
  });

  afterEach(() => {
    websocketService.shutdown();
    server.close();
  });

  it('WebSocket 服务在端口正常启动', () => {
    expect(websocketService.wss).toBeDefined();
    expect(websocketService.wss).toBeInstanceOf(WebSocketServer);
  });

  it('客户端可以连接到 /ws 端点', async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(websocketService.getClientCount()).toBe(1);

    ws.close();
  });

  it('连接后收到 welcome 消息', async () => {
    const ws = new WebSocket(wsUrl);

    const message = await new Promise((resolve, reject) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('No message received')), 5000);
    });

    expect(message.type).toBe('connected');
    expect(message.data.message).toBe('Connected to Cecelia Brain');
    expect(message.timestamp).toBeDefined();

    ws.close();
  });

  it('支持多客户端同时连接', async () => {
    const clients = [];

    // Connect 3 clients
    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(wsUrl);
      await new Promise((resolve) => {
        ws.on('open', resolve);
      });
      clients.push(ws);
    }

    expect(websocketService.getClientCount()).toBe(3);

    // Close all
    clients.forEach(ws => ws.close());
  });

  it('当任务状态更新时，所有连接的客户端收到推送', async () => {
    const client1 = new WebSocket(wsUrl);
    const client2 = new WebSocket(wsUrl);

    const messagesReceived = [];

    // Set up message handlers before waiting for connection
    const messagePromise = Promise.all([
      new Promise(resolve => {
        let firstMessage = true;
        client1.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (firstMessage) {
            firstMessage = false;
            return; // Skip welcome message
          }
          messagesReceived.push(msg);
          resolve(msg);
        });
      }),
      new Promise(resolve => {
        let firstMessage = true;
        client2.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (firstMessage) {
            firstMessage = false;
            return; // Skip welcome message
          }
          messagesReceived.push(msg);
          resolve(msg);
        });
      })
    ]);

    // Wait for both to connect
    await Promise.all([
      new Promise(resolve => client1.on('open', resolve)),
      new Promise(resolve => client2.on('open', resolve))
    ]);

    // Wait a bit for welcome messages to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Broadcast a run update
    const testUpdate = {
      id: 'test-run-123',
      status: 'running',
      progress: 5,
      task_id: 'task-456',
      agent: 'dev',
      started_at: new Date().toISOString(),
      completed_at: null,
      error: null
    };

    websocketService.broadcastRunUpdate(testUpdate);

    const messages = await messagePromise;

    // Both clients should receive the message
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('run_update');
    expect(messages[0].data.id).toBe('test-run-123');
    expect(messages[0].data.status).toBe('running');
    expect(messages[1].type).toBe('run_update');
    expect(messages[1].data.id).toBe('test-run-123');

    client1.close();
    client2.close();
  });

  it('消息格式正确（包含 type, data, timestamp 字段）', async () => {
    const ws = new WebSocket(wsUrl);

    const messagePromise = new Promise(resolve => {
      let firstMessage = true;
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (firstMessage) {
          firstMessage = false;
          return; // Skip welcome message
        }
        resolve(msg);
      });
    });

    await new Promise(resolve => ws.on('open', resolve));

    // Wait a bit for welcome message to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    const testUpdate = {
      id: 'test-run-999',
      status: 'completed',
      progress: 11,
      task_id: 'task-999',
      agent: 'test',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      error: null
    };

    websocketService.broadcastRunUpdate(testUpdate);

    const message = await messagePromise;

    // Verify message structure
    expect(message).toHaveProperty('type');
    expect(message).toHaveProperty('data');
    expect(message).toHaveProperty('timestamp');

    expect(message.type).toBe('run_complete');
    expect(message.data.id).toBe('test-run-999');
    expect(message.data.status).toBe('completed');
    expect(message.data.progress).toBe(11);
    expect(message.data.task_id).toBe('task-999');
    expect(message.data.agent).toBe('test');
    expect(message.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    ws.close();
  });

  it('根据状态自动设置正确的消息类型', async () => {
    const testCases = [
      { status: 'running', expectedType: 'run_update' },
      { status: 'completed', expectedType: 'run_complete' },
      { status: 'failed', expectedType: 'run_failed' }
    ];

    for (const testCase of testCases) {
      const ws = new WebSocket(wsUrl);

      const messagePromise = new Promise(resolve => {
        let firstMessage = true;
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (firstMessage) {
            firstMessage = false;
            return; // Skip welcome message
          }
          resolve(msg);
        });
      });

      await new Promise(resolve => ws.on('open', resolve));

      // Wait a bit for welcome message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      websocketService.broadcastRunUpdate({
        id: 'test-run',
        status: testCase.status,
        progress: 0,
        task_id: 'task',
        agent: 'test',
        started_at: new Date().toISOString(),
        completed_at: null,
        error: null
      });

      const message = await messagePromise;
      expect(message.type).toBe(testCase.expectedType);

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  it('断开连接后客户端从列表中移除', async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise(resolve => ws.on('open', resolve));

    expect(websocketService.getClientCount()).toBe(1);

    ws.close();

    // Wait for close event to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(websocketService.getClientCount()).toBe(0);
  });

  it('向已关闭的客户端发送消息不会崩溃', async () => {
    const ws = new WebSocket(wsUrl);

    await new Promise(resolve => ws.on('open', resolve));

    ws.close();
    await new Promise(resolve => setTimeout(resolve, 100));

    // This should not throw
    expect(() => {
      websocketService.broadcast({
        type: 'test',
        data: { test: true },
        timestamp: new Date().toISOString()
      });
    }).not.toThrow();
  });

  it('广播时忽略无效消息格式', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Invalid: missing type
    websocketService.broadcast({ data: { test: true } });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WS] Invalid message format')
    );

    consoleSpy.mockRestore();
  });
});
