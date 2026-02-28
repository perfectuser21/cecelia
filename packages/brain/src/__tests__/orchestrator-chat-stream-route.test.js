/**
 * orchestrator-chat-stream-route.test.js
 * 测试 POST /api/brain/orchestrator/chat/stream SSE 端点
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock handleChatStream
const mockHandleChatStream = vi.hoisted(() => vi.fn());
vi.mock('../orchestrator-chat.js', () => ({
  handleChat: vi.fn(),
  handleChatStream: mockHandleChatStream,
}));

// Mock db.js (routes.js needs it)
vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// Mock 其他 routes.js 依赖（最小 mock）
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(),
  executeTick: vi.fn(), runTickSafe: vi.fn(), routeTask: vi.fn(),
  drainTick: vi.fn(), getDrainStatus: vi.fn(), cancelDrain: vi.fn(),
  TASK_TYPE_AGENT_MAP: {}, getStartupErrors: vi.fn().mockReturnValue([]),
}));
vi.mock('../actions.js', () => ({
  createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(),
  updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(), setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(), getFocusSummary: vi.fn(),
}));
vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(), getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn().mockReturnValue([]),
  LOCATION_MAP: {},
}));
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockReturnValue(null),
  setActiveProfile: vi.fn(), listProfiles: vi.fn().mockReturnValue([]),
  updateProfileConfig: vi.fn(),
  FALLBACK_PROFILE: {
    config: {
      executor: { model_map: {}, fixed_provider: null },
      mouth: { model: 'MiniMax-M2.5-highspeed', provider: 'minimax' },
    },
  },
}));
vi.mock('../selfcheck.js', () => ({ runSelfCheck: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../websocket.js', () => ({ broadcast: vi.fn(), WS_EVENTS: {}, initWebSocketServer: vi.fn() }));

import express from 'express';
import { createServer } from 'http';

describe('orchestrator-chat-stream-route', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // 动态导入 routes.js（避免顶级副作用干扰）
    const { default: router } = await import('../routes.js');
    app.use('/api/brain', router);
  });

  it('returns 400 for missing message', async () => {
    const res = await sendRequest(app, '/api/brain/orchestrator/chat/stream', { message: '' });
    expect(res.status).toBe(400);
  });

  it('sets SSE headers and calls handleChatStream', async () => {
    // handleChatStream 直接返回，发送 [DONE]
    mockHandleChatStream.mockImplementation(async (_msg, _ctx, _msgs, onChunk) => {
      onChunk('你好', false);
      onChunk('', true);
    });

    const chunks = [];
    await new Promise((resolve, reject) => {
      const server = createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        const http = require('http');
        const req = http.request({
          hostname: 'localhost',
          port,
          path: '/api/brain/orchestrator/chat/stream',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          expect(res.headers['content-type']).toContain('text/event-stream');
          res.on('data', (chunk) => { chunks.push(chunk.toString()); });
          res.on('end', () => {
            server.close();
            resolve();
          });
        });
        req.on('error', reject);
        req.write(JSON.stringify({ message: 'test' }));
        req.end();
      });
    });

    const allData = chunks.join('');
    expect(allData).toContain('data: {"delta":"你好"}');
    expect(allData).toContain('data: [DONE]');
    expect(mockHandleChatStream).toHaveBeenCalledWith(
      'test',
      expect.any(Object),
      expect.any(Array),
      expect.any(Function)
    );
  });
});

// 简单 HTTP 请求辅助（仅用于测 400 场景）
async function sendRequest(app, path, body) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const http = require('http');
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: 'localhost',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        server.close();
        resolve({ status: res.statusCode });
      });
      req.write(data);
      req.end();
    });
  });
}
