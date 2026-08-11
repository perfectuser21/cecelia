/**
 * coding 路由收归 kernel — 改代码任务派发时打标 code_change + gear 并强制进 harness（决策 bf361265）
 *
 * Sprint: sprints/08111158-kernel-89d15e73  (task 89d15e73)
 *
 * 覆盖父路: 独立小路（无父路）—— dispatcher 派发层改代码识别 + kernel 分流。
 *
 * 验收：
 *  1. 纯分类函数 classifyCodeChange / resolveDispatchChannel（真调 task-router，不 mock）
 *     - task_type=dev / codex_dev → code_change=true, channel=kernel
 *     - task_type=research / arch_review → code_change=false, channel=legacy（Invariant 非改代码不受影响）
 *     - 白名单外 + payload.code_change=true（显式扩展点）→ code_change=true
 *  2. dispatcher 派发一个改代码(dev)任务 → 传给 spawn 层(triggerCeceliaRun)的 task 已 reroute 到
 *     kernel（task_type='harness_initiative'）且 payload.code_change===true + payload.gear ∈ 枚举，
 *     且保留 payload.origin_task_type='dev'（legacy dev 直通分支未被走）。
 *  3. dispatcher 派发一个非改代码(research)任务 → 传给 spawn 层的 task_type 不变、无 code_change 标（行为不变）。
 *  4. 幂等：已在 kernel 通道 / 已标 code_change 的任务再次派发 → 不重复打标、不产生二次 reroute。
 *
 * 回归防护：本测试永久留 CI（brain-unit，vi.mock('../db.js') 纯单元），防止收归被回退。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── task-router 纯函数（真实模块，禁 mock 被改的分类边）─────────────────────────
import {
  classifyCodeChange,
  resolveDispatchChannel,
  CODE_CHANGE_TASK_TYPES,
} from '../task-router.js';

// ── dispatcher 派发链所需 mock（照 dispatcher-dev-no-langgraph.test.js 现行 mock 集）──
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  selectNextDispatchableTask: vi.fn(),
  calculateSlotBudget: vi.fn(),
  shouldDowngrade: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));
vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: mocks.triggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: mocks.calculateSlotBudget,
  shouldBypassBackpressure: vi.fn(() => false),
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: mocks.shouldDowngrade }));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../tick-stats.js', () => ({
  incrementActionsToday: vi.fn().mockResolvedValue(1),
  recordTickExecution: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: false, drain_mode_requested: false })),
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('../tick-status.js', () => ({
  logTickDecision: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: mocks.selectNextDispatchableTask,
  processCortexTask: vi.fn().mockResolvedValue({ handled: false }),
}));

import { dispatchNextTask } from '../dispatcher.js';

// ── helpers ────────────────────────────────────────────────────────────────────
function makeTask(overrides = {}) {
  return {
    id: 'code-route-task-001',
    title: 'coding route kernel test task',
    task_type: 'dev',
    status: 'queued',
    priority: 'P1',
    description: 'Implement feature X per PRD (real code change).',
    payload: {},
    metadata: {},
    retry_count: 0,
    project_id: null,
    executor_kind: null,
    // 锚点执法豁免：created_at < ANCHOR_LEGACY_CUTOFF_DAY(2026-07-17)，存量任务不受锚点门禁影响，
    // 使派发链走到 spawn 决策点（anchor gate 非本 sprint 关注对象）。
    created_at: '2026-07-16T00:00:00Z',
    ...overrides,
  };
}

function setupDispatch(task) {
  mocks.selectNextDispatchableTask.mockResolvedValueOnce(task);
  mocks.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('SELECT * FROM tasks')) {
      return Promise.resolve({ rows: [task] });
    }
    if (typeof sql === 'string' && sql.includes('claimed_by') && sql.includes('RETURNING id')) {
      return Promise.resolve({ rows: [{ id: task.id }], rowCount: 1 });
    }
    if (typeof sql === 'string' && sql.includes('UPDATE tasks')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [] });
  });
}

const GEAR_ENUM = ['default', 'hotfix', 'segmented'];

// ── 1) 纯分类函数（真实 task-router）──────────────────────────────────────────────
describe('classifyCodeChange / resolveDispatchChannel [BEHAVIOR]', () => {
  it('task_type=dev 判定改代码且 channel=kernel', () => {
    const t = makeTask({ task_type: 'dev' });
    expect(classifyCodeChange(t).code_change).toBe(true);
    expect(resolveDispatchChannel(t)).toBe('kernel');
  });

  it('task_type=codex_dev 判定改代码', () => {
    expect(classifyCodeChange(makeTask({ task_type: 'codex_dev' })).code_change).toBe(true);
    expect(CODE_CHANGE_TASK_TYPES.has('codex_dev')).toBe(true);
  });

  it('非改代码 task_type=research/arch_review 判定非改代码且 channel=legacy（行为不变）', () => {
    for (const tt of ['research', 'arch_review', 'talk', 'data']) {
      const t = makeTask({ task_type: tt });
      expect(classifyCodeChange(t).code_change).toBe(false);
      expect(resolveDispatchChannel(t)).toBe('legacy');
    }
  });

  it('白名单外 + 显式 payload.code_change=true 扩展点 → 判定改代码', () => {
    const t = makeTask({ task_type: 'research', payload: { code_change: true } });
    expect(classifyCodeChange(t).code_change).toBe(true);
    expect(resolveDispatchChannel(t)).toBe('kernel');
  });
});

// ── 2~4) dispatcher 派发分流 + 打标 + 幂等 ────────────────────────────────────────
describe('dispatcher 改代码任务收归 kernel [BEHAVIOR]', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.triggerCeceliaRun.mockReset();
    mocks.selectNextDispatchableTask.mockReset();
    mocks.calculateSlotBudget.mockReset();
    mocks.shouldDowngrade.mockReset();
    mocks.selectNextDispatchableTask.mockResolvedValue(null);
    mocks.triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'run-code-001' });
    mocks.calculateSlotBudget.mockResolvedValue({
      dispatchAllowed: true,
      taskPool: { budget: 5, available: 3 },
      user: { mode: 'absent', used: 0 },
      codex: { available: true, running: 0, max: 5 },
    });
    mocks.shouldDowngrade.mockReturnValue(false);
  });

  it('dev 改代码任务派发 → spawn 层收到 reroute 到 harness_initiative 且已打标 code_change+gear', async () => {
    const task = makeTask({ task_type: 'dev' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    // reroute 到 kernel harness 通道（executor.triggerCeceliaRun 内 harness_initiative 分支 → runHarnessInitiativeRouter → initiative_runs）
    expect(dispatched.task_type).toBe('harness_initiative');
    // 打标
    expect(dispatched.payload?.code_change).toBe(true);
    expect(GEAR_ENUM).toContain(dispatched.payload?.gear);
    // 原 task_type 保留，供 kernel 侧还原/审计
    expect(dispatched.payload?.origin_task_type).toBe('dev');
  });

  it('非改代码 research 任务派发 → task_type 不变、无 code_change 标（行为不变，Invariant）', async () => {
    const task = makeTask({ id: 'research-task-001', task_type: 'research' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.task_type).toBe('research');
    expect(dispatched.payload?.code_change).toBeUndefined();
  });

  it('幂等：已标 code_change 且已在 harness_initiative 的任务再派发 → 不重复 reroute/打标', async () => {
    const task = makeTask({
      id: 'already-kernel-001',
      task_type: 'harness_initiative',
      payload: { code_change: true, gear: 'default', origin_task_type: 'dev' },
    });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    const dispatched = mocks.triggerCeceliaRun.mock.calls[0][0];
    expect(dispatched.task_type).toBe('harness_initiative');
    expect(dispatched.payload?.code_change).toBe(true);
    // 幂等：origin_task_type 不被二次覆盖成 'harness_initiative'
    expect(dispatched.payload?.origin_task_type).toBe('dev');
  });
});
