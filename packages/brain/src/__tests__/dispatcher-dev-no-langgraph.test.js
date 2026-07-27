/**
 * TDD: dev 派发迁离 LangGraph（F7）
 *
 * 验收：
 * - dev task 派发不再经 _dispatchViaWorkflowRuntime / runWorkflow('dev-task')
 * - dev task 走 triggerCeceliaRun，执行后 dispatched:true 且 runtime != 'v2'
 * - _dispatchViaWorkflowRuntime 不在 dispatcher 导出（函数已删除）
 * - orchestrator/graph-runtime.js + orchestrator/workflow-registry.js 物理不存在
 *   （刀4a 死码清理：LangGraph workflow runtime 整体移除，import 必失败）
 *
 * 回归防护：此测试永久留 CI，防止 LangGraph 路径被意外复活。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted：mock 工厂内引用的函数必须用 vi.hoisted 创建
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
// 顶层 import（在 vi.mock 之后）
import { dispatchNextTask } from '../dispatcher.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDevTask(overrides = {}) {
  return {
    id: 'dev-task-t6-001',
    title: 'T6 dev task for LangGraph migration test',
    task_type: 'dev',
    status: 'queued',
    priority: 'P1',
    description: 'Implement feature X per PRD: remove LangGraph dispatch path and route dev tasks through triggerCeceliaRun local spawn.',
    payload: {},
    metadata: {},
    retry_count: 0,
    project_id: null,
    executor_kind: null,
    // S2 锚点执法豁免：存量任务（刀2上线前创建），不受锚点门禁影响
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
    // 原子 claim：RETURNING id 必须返回行，否则 dispatcher 认为已被他人抢占
    if (typeof sql === 'string' && sql.includes('claimed_by') && sql.includes('RETURNING id')) {
      return Promise.resolve({ rows: [{ id: task.id }], rowCount: 1 });
    }
    if (typeof sql === 'string' && sql.includes('UPDATE tasks')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [] });
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('F7: dev 派发迁离 LangGraph', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.triggerCeceliaRun.mockReset();
    mocks.selectNextDispatchableTask.mockReset();
    mocks.calculateSlotBudget.mockReset();
    mocks.shouldDowngrade.mockReset();
    mocks.selectNextDispatchableTask.mockResolvedValue(null);
    mocks.triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'run-t6-001' });
    mocks.calculateSlotBudget.mockResolvedValue({
      dispatchAllowed: true,
      taskPool: { budget: 5, available: 3 },
      user: { mode: 'absent', used: 0 },
      codex: { available: true, running: 0, max: 5 },
    });
    mocks.shouldDowngrade.mockReturnValue(false);
  });

  it('dev task 派发 → triggerCeceliaRun 被调', async () => {
    const task = makeDevTask();
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    expect(mocks.triggerCeceliaRun.mock.calls[0][0].id).toBe(task.id);
  });

  it('LangGraph workflow runtime 物理不存在（graph-runtime / workflow-registry 已删除）', async () => {
    await expect(
      import('../orchestrator/graph-runtime.js')
    ).rejects.toThrow();
    await expect(
      import('../orchestrator/workflow-registry.js')
    ).rejects.toThrow();
  });

  it('dev task 派发结果 runtime 不为 v2（已迁离 LangGraph）', async () => {
    const task = makeDevTask();
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(result.runtime).not.toBe('v2');
  });

  it('_dispatchViaWorkflowRuntime 不在 dispatcher 导出（函数已物理删除）', async () => {
    const dispatcherModule = await import('../dispatcher.js');
    expect(dispatcherModule._dispatchViaWorkflowRuntime).toBeUndefined();
  });

  it('non-dev task_type 也走 triggerCeceliaRun（行为不变）', async () => {
    const task = makeDevTask({ id: 'code-review-task', task_type: 'code_review' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
  });

  it('budget_state=tight 且任务可降级时，传给 triggerCeceliaRun 的 payload.executor 必须是 codex', async () => {
    const task = makeDevTask({ id: 'dev-task-downgrade-001', payload: { orchestrator: 'skill-relay' } });
    setupDispatch(task);
    mocks.calculateSlotBudget.mockResolvedValueOnce({
      dispatchAllowed: true,
      budgetState: { state: 'tight' },
      taskPool: { budget: 5, available: 3 },
      user: { mode: 'absent', used: 0 },
      codex: { available: true, running: 0, max: 5 },
    });
    // 引导员在候选阶段与派发阶段各调一次 shouldDowngrade，两次都须返回 tight 判定
    mocks.shouldDowngrade.mockReturnValue(true);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
    expect(mocks.triggerCeceliaRun.mock.calls[0][0].payload?.executor).toBe('codex');
  });
});
