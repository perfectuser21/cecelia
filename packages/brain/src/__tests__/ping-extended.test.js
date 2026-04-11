/**
 * ping-extended.test.js
 * 验证 GET /api/brain/ping-extended 扩展健康检查端点
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock status.js 的依赖
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

describe('ping-extended', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../routes/status.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  it('GET /api/brain/ping-extended 返回 200 + 恰好 3 个字段', async () => {
    const res = await request(app).get('/api/brain/ping-extended');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body);
    expect(keys).toHaveLength(3);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('version');
  });

  it('version 字段是 semver 格式', async () => {
    const res = await request(app).get('/api/brain/ping-extended');
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('timestamp 字段是有效 ISO8601', async () => {
    const res = await request(app).get('/api/brain/ping-extended');
    const d = new Date(res.body.timestamp);
    expect(d.getTime()).not.toBeNaN();
  });

  it('POST /api/brain/ping-extended 返回 405', async () => {
    const res = await request(app).post('/api/brain/ping-extended');
    expect(res.status).toBe(405);
  });
});
