/**
 * xian-bridge-health.test.js
 *
 * 覆盖 GET /api/brain/health 新增的 xian_bridge_status 字段：
 *   - checkXianBridgeHealth: Bridge 2xx → "online"
 *   - checkXianBridgeHealth: 连接失败/超时/非 2xx → "offline"
 *   - 响应体顶层含 xian_bridge_status 字段，类型为 string
 *
 * DoD 对应：
 *   [BEHAVIOR] curl -sf localhost:5221/api/brain/health | jq -e '.xian_bridge_status | . == "online" or . == "offline"'
 *   [BEHAVIOR] curl -sf localhost:5221/api/brain/health | jq -e '.xian_bridge_status | type == "string"'
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock 依赖（hoisted，goals.js 加载前生效）─────────────────────────────────

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({
    loop_running: true,
    enabled: true,
    last_tick: null,
    max_concurrent: 3,
    tick_stats: { total_executions: 0, last_executed_at: null, last_duration_ms: null },
  }),
  startTick: vi.fn(),
  stopTick: vi.fn(),
}));

vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  resetBreaker: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue({
    level: 0,
    levelName: 'SLEEPING',
    startedAt: new Date(),
    reason: null,
    isRecovering: false,
    lastEvaluation: null,
    override: null,
  }),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));

vi.mock('../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn().mockReturnValue({ total: 0, success: 0, fail: 0 }),
}));

vi.mock('../task-cleanup.js', () => ({
  getCleanupStats: vi.fn().mockReturnValue({ cleaned: 0 }),
  runTaskCleanup: vi.fn().mockResolvedValue({ cleaned: 0 }),
  getCleanupAuditLog: vi.fn().mockReturnValue([]),
}));

vi.mock('../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn().mockResolvedValue([]),
}));

vi.mock('../docker-runtime-probe.js', () => ({
  probe: vi.fn().mockResolvedValue({
    enabled: false,
    status: 'disabled',
    reachable: false,
    version: null,
    error: null,
  }),
  dockerRuntimeProbe: vi.fn(),
  default: vi.fn(),
}));

vi.mock('../okr-tick.js', () => ({
  executeOkrTick: vi.fn(),
  runOkrTickSafe: vi.fn().mockResolvedValue({}),
  startOkrTickLoop: vi.fn(),
  stopOkrTickLoop: vi.fn(),
  getOkrTickStatus: vi.fn().mockReturnValue({ running: false }),
  addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(),
  getPendingQuestions: vi.fn().mockResolvedValue([]),
  OKR_STATUS: {
    PENDING: 'pending', NEEDS_INFO: 'needs_info', READY: 'ready',
    DECOMPOSING: 'decomposing', IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed', CANCELLED: 'cancelled',
  },
}));

vi.mock('../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn().mockResolvedValue({}),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn().mockReturnValue({ running: false }),
  getDailyReports: vi.fn().mockResolvedValue([]),
}));

// ── App 构建（beforeAll，mock 生效后再 import）────────────────────────────────

let app;

beforeAll(async () => {
  const { default: goalsRouter } = await import('../routes/goals.js');
  app = express();
  app.use(express.json());
  app.use('/api/brain', goalsRouter);
});

// ── 每个 case 前重置 pool mock + fetch mock ───────────────────────────────────

beforeEach(() => {
  mockPool.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('harness_initiative')) {
      return Promise.resolve({ rows: [{ cnt: 0 }] });
    }
    // evaluator stats（harness_evaluate）或其他查询
    return Promise.resolve({ rows: [{ passed: 0, failed: 0, last_run_at: null }] });
  });
  // 默认 online
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── 测试套件 ─────────────────────────────────────────────────────────────────

describe('GET /api/brain/health — xian_bridge_status', () => {
  it('响应体含顶层 xian_bridge_status 字段', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('xian_bridge_status');
  });

  it('xian_bridge_status 值为 "online" 或 "offline"', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(['online', 'offline']).toContain(res.body.xian_bridge_status);
  });

  it('xian_bridge_status 类型必须是 string', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(typeof res.body.xian_bridge_status).toBe('string');
  });

  it('Bridge 返回 2xx → xian_bridge_status: "online"', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const res = await request(app).get('/api/brain/health');

    expect(res.status).toBe(200);
    expect(res.body.xian_bridge_status).toBe('online');
  });

  it('Bridge 连接失败（ECONNREFUSED）→ xian_bridge_status: "offline"', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 100.86.57.69:3458'));

    const res = await request(app).get('/api/brain/health');

    expect(res.status).toBe(200);
    expect(res.body.xian_bridge_status).toBe('offline');
  });

  it('Bridge 返回非 2xx（503）→ xian_bridge_status: "offline"', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const res = await request(app).get('/api/brain/health');

    expect(res.status).toBe(200);
    expect(res.body.xian_bridge_status).toBe('offline');
  });

  it('xian_bridge_status: "offline" 不触发顶层 status 降级', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

    const res = await request(app).get('/api/brain/health');

    expect(res.status).toBe(200);
    // Bridge 离线不影响顶层 status
    expect(res.body.status).toBe('healthy');
  });
});
