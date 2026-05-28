/**
 * /api/brain/health codex_bridge_status 字段集成测试（WS2）
 *
 * DoD:
 *   - bridge 返回 2xx → codex_bridge_status = "online"
 *   - bridge 返回非 2xx → codex_bridge_status = "offline"
 *   - bridge 超时（AbortSignal.timeout）→ codex_bridge_status = "offline"
 *   - bridge throw → codex_bridge_status = "offline"
 *   - schema 完整性：status + uptime_seconds + codex_bridge_status 共存
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
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
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: { 0: 'Sleeping', 1: 'Calm', 2: 'Aware', 3: 'Alert', 4: 'Panic' },
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

function setupDefaultMocks() {
  __dockerRuntimeProbeMock.mockResolvedValue({
    enabled: true,
    status: 'healthy',
    reachable: true,
    version: '24.0.7',
    error: null,
  });
  __poolMock.query.mockImplementation((sql) => {
    if (/harness_initiative/.test(sql)) {
      return Promise.resolve({ rows: [{ cnt: 0 }] });
    }
    if (/harness_evaluate/.test(sql)) {
      return Promise.resolve({ rows: [{ passed: 0, failed: 0, last_run_at: null }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('codex_bridge_status 字段 — bridge 探活四分支', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
  });

  beforeEach(() => {
    __dockerRuntimeProbeMock.mockReset();
    __poolMock.query.mockReset();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bridge 返回 2xx -> codex_bridge_status = online', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body.codex_bridge_status).toBe("online");
  });

  it('bridge 返回非 2xx -> codex_bridge_status = offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body.codex_bridge_status).toBe("offline");
  });

  it('bridge timeout AbortSignal.timeout -> codex_bridge_status = offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    ));

    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body.codex_bridge_status).toBe("offline");
  });

  it('bridge throw Error -> codex_bridge_status = offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body.codex_bridge_status).toBe("offline");
  });

  it('schema 完整性 — status uptime_seconds codex_bridge_status 同时存在', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const res = await request(app).get('/api/brain/health').expect(200);

    expect(res.body).toHaveProperty('codex_bridge_status');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('uptime_seconds');
    expect(typeof res.body.codex_bridge_status).toBe('string');
  });

  it('codex_bridge_status 不含禁用变体 up down ok reachable active unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const res = await request(app).get('/api/brain/health').expect(200);

    const forbidden = ['up', 'down', 'ok', 'reachable', 'active', 'unavailable'];
    expect(forbidden).not.toContain(res.body.codex_bridge_status);
    expect(res.body.codex_bridge_status).not.toBeNull();
  });
});
