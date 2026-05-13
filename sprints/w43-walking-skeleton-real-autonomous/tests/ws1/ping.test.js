/**
 * TDD Red 阶段：/ping endpoint 行为验证
 *
 * 预期 Red 证据：/ping 路由尚未添加到 status.js 时，
 * GET /api/brain/ping 返回 404（路由不存在），所有断言 FAIL：
 *   - 期望 status=200，实际 404
 *   - 期望 pong=true，实际 body 为 {}
 *   - 期望 ts 是 number，实际 undefined
 *   - 期望 keys=["pong","ts"]，实际 []
 *   - 期望 POST 返 405，实际可能返 404
 * Green 阶段：实现路由后全部通过
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../packages/brain/src/db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../../../packages/brain/src/focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));
vi.mock('../../../../packages/brain/src/tick.js', () => ({
  getTickStatus: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../../../../packages/brain/src/dispatch-stats.js', () => ({
  getDispatchStats: vi.fn(),
}));
vi.mock('../../../../packages/brain/src/routes/shared.js', () => ({
  getActivePolicy: vi.fn(),
  getWorkingMemory: vi.fn(),
  getTopTasks: vi.fn().mockResolvedValue([]),
  getRecentDecisions: vi.fn().mockResolvedValue([]),
  IDEMPOTENCY_TTL: 300000,
  ALLOWED_ACTIONS: {},
}));
vi.mock('../../../../packages/brain/src/nightly-orchestrator.js', () => ({
  getNightlyOrchestratorStatus: vi.fn().mockReturnValue({}),
}));
vi.mock('../../../../packages/brain/src/websocket.js', () => ({
  default: {
    wss: null,
    getClientCount: vi.fn().mockReturnValue(0),
    broadcast: vi.fn(),
  },
  WS_EVENTS: {},
}));

describe('GET /api/brain/ping', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../../packages/brain/src/routes/status.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);
  });

  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(res.status).toBe(200);
  });

  it('pong 字段值严格等于 true（boolean）', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(res.body.pong).toBe(true);
  });

  it('ts 是 number 类型且在 Unix seconds 范围（非毫秒）', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(typeof res.body.ts).toBe('number');
    expect(res.body.ts).toBeGreaterThan(1_000_000_000);
    expect(res.body.ts).toBeLessThan(10_000_000_000);
  });

  it('response 顶层 keys 恰好为 ["pong","ts"]（schema 完整性）', async () => {
    const res = await request(app).get('/api/brain/ping');
    expect(Object.keys(res.body).sort()).toEqual(['pong', 'ts']);
  });

  it('禁用字段 ok/alive/status/timestamp/result/data 全部不存在', async () => {
    const res = await request(app).get('/api/brain/ping');
    for (const key of ['ok', 'alive', 'status', 'timestamp', 'result', 'data']) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it('POST /api/brain/ping → 405 且 error 字段字面值等于 "Method Not Allowed"', async () => {
    const res = await request(app).post('/api/brain/ping');
    expect(res.status).toBe(405);
    expect(res.body.error).toBe('Method Not Allowed');
  });
});
