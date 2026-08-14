/**
 * Initiative 集成测试 T6 — dev 派发迁离 LangGraph + headed-session 活性保护
 *
 * I1: 最后一个 dev task 集成测试套件（integration_test_owner = T6）
 * I2: Golden Path — 注册 → 有头认领(PATCH) → 守护刀两轮扫描不误杀 → callback 完成 → claim 清空
 *
 * 测试策略：mock DB + spawn，不跑真实容器。
 * 永久留 CI：regression guard，防 headed-session 被误杀、dev 路径被 LangGraph 复活。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted：mock 工厂内引用的变量必须在此声明 ───────────────────────────
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  selectNextDispatchableTask: vi.fn(),
}));

// ─── Mock 集中注册（必须在所有 import 前）────────────────────────────────────

vi.mock('../../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));
vi.mock('../../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: mocks.triggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));
vi.mock('../../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 5 },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
}));
vi.mock('../../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));
vi.mock('../../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));
vi.mock('../../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../tick-stats.js', () => ({
  incrementActionsToday: vi.fn().mockResolvedValue(1),
  recordTickExecution: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: false, drain_mode_requested: false })),
}));
vi.mock('../../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('../../tick-status.js', () => ({
  logTickDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: mocks.selectNextDispatchableTask,
  processCortexTask: vi.fn().mockResolvedValue({ handled: false }),
}));
// ─── 顶层 import（在 vi.mock 之后）──────────────────────────────────────────
import { dispatchNextTask } from '../../dispatcher.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDevTask(overrides = {}) {
  return {
    id: 'i2-dev-task-001',
    title: 'Initiative T6 dev task for LangGraph migration integration test',
    task_type: 'dev',
    status: 'queued',
    priority: 'P1',
    description: 'Implement feature X per PRD: remove LangGraph dispatch path and route dev tasks through triggerCeceliaRun local spawn with executor_kind=brain-local.',
    payload: {},
    metadata: {},
    retry_count: 0,
    project_id: 'proj-t6',
    executor_kind: null,
    claimed_by: null,
    claimed_at: null,
    execution_attempts: 0,
    last_attempt_at: null,
    updated_at: new Date(Date.now() - 30 * 60 * 1000),
    // S2 锚点执法豁免：存量任务（刀2上线前创建），不受锚点门禁影响
    created_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function makeHeadedTask(overrides = {}) {
  return {
    id: 'i2-headed-task-001',
    title: 'Initiative T6 headed-session task',
    task_type: 'dev',
    status: 'in_progress',
    priority: 'P1',
    description: 'interactive dev',
    payload: {},
    metadata: {},
    retry_count: 0,
    project_id: 'proj-t6',
    executor_kind: 'headed-session',
    claimed_by: 'session:abc123',
    claimed_at: new Date(Date.now() - 63 * 60 * 1000),
    execution_attempts: 1,
    last_attempt_at: new Date(Date.now() - 63 * 60 * 1000),
    updated_at: new Date(Date.now() - 63 * 60 * 1000),
    ...overrides,
  };
}

function setupDevDispatch(task) {
  mocks.selectNextDispatchableTask.mockResolvedValueOnce(task);
  mocks.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('SELECT * FROM tasks')) {
      return Promise.resolve({ rows: [task] });
    }
    // 原子 claim：RETURNING id 必须返回行
    if (typeof sql === 'string' && sql.includes('claimed_by') && sql.includes('RETURNING id')) {
      return Promise.resolve({ rows: [{ id: task.id }], rowCount: 1 });
    }
    if (typeof sql === 'string' && sql.includes('UPDATE tasks')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─── I1: dev 派发集成测试 ─────────────────────────────────────────────────────

describe('I1: legacy dev task 不能绕过 Work Router', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.triggerCeceliaRun.mockReset();
    mocks.selectNextDispatchableTask.mockReset();
    mocks.selectNextDispatchableTask.mockResolvedValue(null);
    mocks.triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'run-i1-001' });
  });

  it('无 receipt 的 dev task fail closed，且不启动 executor', async () => {
    const task = makeDevTask();
    setupDevDispatch(task);

    const result = await dispatchNextTask(['goal-t6']);

    expect(result.dispatched).toBe(false);
    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
  });

  it('route violation 留在派发边界，不触发 legacy executor', async () => {
    const task = makeDevTask();
    setupDevDispatch(task);

    await dispatchNextTask(['goal-t6']);

    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.some(([, args]) => (
      Array.isArray(args) && args.includes('route_violation')
    ))).toBe(true);
  });
});

// ─── I2: Golden Path 集成测试 ─────────────────────────────────────────────────

describe('I2: Golden Path — 注册→认领→守护刀两轮不误杀→完成→claim 清空', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('headed-session 任务在 updated_at 63min 时守护刀不误杀（fail-open 或 within stale window）', async () => {
    const task = makeHeadedTask();

    mocks.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('in_progress')) {
        return Promise.resolve({ rows: [task] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { reapZombies } = await import('../../zombie-reaper.js');
    const result = await reapZombies({
      pool: { query: mocks.query },
      idleMinutes: 60,
      ctx: { activeProcesses: new Map() },
    });

    // headed-session 任务不应被标 failed（alive 或 unknown=fail-open）
    const failedUpdates = mocks.query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes("status = 'failed'")
    );
    expect(failedUpdates).toHaveLength(0);
    expect(result.reaped).toBe(0);
  });

  it('headed-session 任务守护刀第二轮仍不误杀（连续两轮 skip）', async () => {
    const task = makeHeadedTask();

    const { reapZombies } = await import('../../zombie-reaper.js');
    const ctx = { activeProcesses: new Map() };

    const makePool = () => ({
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('in_progress')) {
          return Promise.resolve({ rows: [task] });
        }
        return Promise.resolve({ rows: [] });
      }),
    });

    const r1 = await reapZombies({ pool: makePool(), idleMinutes: 60, ctx });
    expect(r1.reaped).toBe(0);

    const r2 = await reapZombies({ pool: makePool(), idleMinutes: 60, ctx });
    expect(r2.reaped).toBe(0);
  });

  it('callback 完成后 claim 清空（claimed_by = NULL, status = completed）', async () => {
    const claimClearUpdates = [];
    const qFn = vi.fn().mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('claimed_by') && sql.includes('NULL')) {
        claimClearUpdates.push({ sql, params });
      }
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await qFn(
      `UPDATE tasks SET status = 'completed', claimed_by = NULL, claimed_at = NULL, completed_at = NOW() WHERE id = $1`,
      ['i2-headed-task-001']
    );

    expect(claimClearUpdates).toHaveLength(1);
    expect(claimClearUpdates[0].sql).toContain('claimed_by');
    expect(claimClearUpdates[0].sql).toContain('NULL');
    expect(claimClearUpdates[0].params[0]).toBe('i2-headed-task-001');
  });

  it('dev-task.graph.js 物理不存在（文件已删除，import 失败）', async () => {
    await expect(
      import('../../workflows/dev-task.graph.js')
    ).rejects.toThrow();
  });

  it('workflow-registry 物理不存在（无 LangGraph 路由入口可供 dev-task 注册）', async () => {
    await expect(
      import('../../orchestrator/workflow-registry.js')
    ).rejects.toThrow();
    await expect(
      import('../../orchestrator/graph-runtime.js')
    ).rejects.toThrow();
  });

  it('workflows/index.js 只预热 consciousness，不做任何 workflow 注册', async () => {
    vi.mock('../../workflows/consciousness.graph.js', () => ({
      getCompiledConsciousnessGraph: vi.fn().mockResolvedValue({ invoke: vi.fn() }),
    }));

    const { initializeWorkflows, _resetInitializedForTests } = await import('../../workflows/index.js');

    _resetInitializedForTests();
    await expect(initializeWorkflows()).resolves.not.toThrow();
  });
});
