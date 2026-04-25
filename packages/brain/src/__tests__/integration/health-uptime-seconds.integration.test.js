/**
 * /api/brain/health 新增 uptime_seconds 字段
 *
 * DoD:
 *   - 响应包含 uptime_seconds（number, >= 0）
 *   - 既有 uptime 字段保留，且与 uptime_seconds 同值
 *   - status='error' 错误分支响应结构与状态码保持不变
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({
    loop_running: true,
    enabled: true,
    last_tick: new Date().toISOString(),
    max_concurrent: 3,
    tick_stats: { total_executions: 0, last_executed_at: null, last_duration_ms: null },
  }),
  startTick: vi.fn(),
  stopTick: vi.fn(),
}));

vi.mock('../../circuit-breaker.js', () => ({
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue('normal'),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  ALERTNESS_LEVELS: { NORMAL: 'normal', ELEVATED: 'elevated', HIGH: 'high' },
  LEVEL_NAMES: { normal: 'Normal', elevated: 'Elevated', high: 'High' },
}));

vi.mock('../../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn().mockReturnValue({ total: 0, success: 0, fail: 0 }),
}));

vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn().mockReturnValue({ cleaned: 0 }),
  runTaskCleanup: vi.fn().mockResolvedValue({ cleaned: 0 }),
  getCleanupAuditLog: vi.fn().mockReturnValue([]),
}));

vi.mock('../../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn().mockResolvedValue([]),
}));

const { probeMock: __dockerRuntimeProbeMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
}));
vi.mock('../../docker-runtime-probe.js', () => ({
  probe: __dockerRuntimeProbeMock,
  dockerRuntimeProbe: __dockerRuntimeProbeMock,
  default: __dockerRuntimeProbeMock,
}));

const { poolMock: __poolMock } = vi.hoisted(() => ({
  poolMock: { query: vi.fn() },
}));
vi.mock('../../db.js', () => ({
  default: __poolMock,
  pool: __poolMock,
}));

async function makeApp() {
  const app = express();
  app.use(express.json());
  const goalsRouter = (await import('../../routes/goals.js')).default;
  app.use('/api/brain', goalsRouter);
  return app;
}

describe('/api/brain/health uptime_seconds 字段', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
  });

  beforeEach(() => {
    __dockerRuntimeProbeMock.mockReset();
    __dockerRuntimeProbeMock.mockResolvedValue({
      enabled: true,
      status: 'healthy',
      reachable: true,
      version: '24.0.7',
      error: null,
    });
    __poolMock.query.mockReset();
    __poolMock.query.mockImplementation((sql) => {
      if (/harness_planner/.test(sql)) {
        return Promise.resolve({ rows: [{ cnt: 0 }] });
      }
      if (/harness_evaluate/.test(sql)) {
        return Promise.resolve({ rows: [{ passed: 0, failed: 0, last_run_at: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('响应包含 uptime_seconds（number, 非负整数）', async () => {
    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body).toHaveProperty('uptime_seconds');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(res.body.uptime_seconds)).toBe(true);
  });

  it('既有 uptime 字段保留，且与 uptime_seconds 同值', async () => {
    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBe(res.body.uptime_seconds);
  });

  it("status='error' 错误分支响应结构与状态码不变（500 + status:error + error 字段）", async () => {
    __poolMock.query.mockReset();
    __poolMock.query.mockImplementation(() => Promise.reject(new Error('boom')));

    const res = await request(app).get('/api/brain/health').expect(500);

    expect(res.body.status).toBe('error');
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });
});
