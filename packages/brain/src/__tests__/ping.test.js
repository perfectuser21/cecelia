/**
 * ping.test.js
 * 验证 GET /api/brain/ping 和 ALL /api/brain/ping 路由
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock status.js 的依赖（同 ping-extended.test.js 结构）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../dispatch-stats.js', () => ({ getDispatchStats: vi.fn() }));
vi.mock('./shared.js', () => ({
  getActivePolicy: vi.fn(),
  getWorkingMemory: vi.fn(),
  getTopTasks: vi.fn().mockResolvedValue([]),
  getRecentDecisions: vi.fn().mockResolvedValue([]),
  IDEMPOTENCY_TTL: 300000,
  ALLOWED_ACTIONS: {},
}));
vi.mock('../nightly-orchestrator.js', () => ({
  getNightlyOrchestratorStatus: vi.fn().mockReturnValue({}),
}));
vi.mock('../websocket.js', () => ({
  default: { wss: null, getClientCount: vi.fn().mockReturnValue(0), broadcast: vi.fn() },
}));

describe('ping', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../routes/status.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  it('GET /api/brain/ping 返回 200', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(res.status).toBe(200);
  });

  it('GET /api/brain/ping 响应 keys 恰好为 ["pong","ts"]', async () => {
    const res = await request(app).get('/api/brain/ping');
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['pong', 'ts'].sort());
  });

  it('GET /api/brain/ping 返回 pong:true', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(res.body.pong).toBe(true);
  });

  it('GET /api/brain/ping 返回 ts 为 unix 秒（整数，合理范围）', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await request(app).get('/api/brain/ping');
    const after = Math.floor(Date.now() / 1000);
    expect(Number.isInteger(res.body.ts)).toBe(true);
    expect(res.body.ts).toBeGreaterThanOrEqual(before);
    expect(res.body.ts).toBeLessThanOrEqual(after);
  });

  it('POST /api/brain/ping 返回 405', async () => {
    const res = await request(app).post('/api/brain/ping');
    expect(res.status).toBe(405);
  });

  it('POST /api/brain/ping 返回精确错误字符串 "Method Not Allowed"', async () => {
    const res = await request(app).post('/api/brain/ping');
    expect(res.body.error).toBe('Method Not Allowed');
  });

  it('GET /api/brain/ping-extended 不受影响，仍返回 200', async () => {
    const res = await request(app).get('/api/brain/ping-extended');
    expect(res.status).toBe(200);
  });
});
