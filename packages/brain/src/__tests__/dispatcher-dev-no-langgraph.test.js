/** 当前派发所有权：无合法归属的dev不得在调度器内猜改后执行，普通审查保持派发。 */

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
  calculateSlotBudget: mocks.calculateSlotBudget,
  shouldBypassBackpressure: vi.fn(() => false),
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: mocks.shouldDowngrade }));
vi.mock('../llm-capacity.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getLlmCapacitySnapshot: vi.fn().mockResolvedValue({
    sampled_at: '2026-08-11T00:00:00.000Z',
    sentinel: 'dispatcher-dev-no-langgraph-test',
    vendors: {
      claude: { available_count: 1, total_count: 1, poller: 'ok', accounts: [] },
      codex: { available_count: 1, total_count: 1, poller: 'ok', accounts: [] },
      grok: { available_count: 0, total_count: 1, poller: 'ok', accounts: [] },
    },
  }),
}));
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
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn(async () => ({passed:true,issues:[],suggestions:[]})),
  getPreFlightStats: vi.fn(async () => ({})), alertOnPreFlightFail: vi.fn(),
}));
// 顶层 import（在 vi.mock 之后）
import { dispatchNextTask } from '../dispatcher.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDevTask(overrides = {}) {
  return {
    id: 'dev-task-t6-001',
    title: '开发任务派发所有权测试',
    task_type: 'dev',
    status: 'queued',
    priority: 'P1',
    description: '只能由合法当前执行者认领和执行开发任务。',
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

describe('当前开发任务派发所有权', () => {
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

  it('存量 dev 缺 receipt 时 fail closed，绝不在 Dispatcher 内改写后执行', async () => {
    const task = makeDevTask();
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result).toMatchObject({ dispatched: false, reason: 'dispatch_exception', error: 'route_violation' });
    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cecelia_events'),
      ['route_violation', expect.stringContaining(`\"task_id\":\"${task.id}\"`)],
    );
  });

  it('non-dev task_type 也走 triggerCeceliaRun（行为不变）', async () => {
    const task = makeDevTask({ id: 'code-review-task', task_type: 'code_review' });
    setupDispatch(task);

    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mocks.triggerCeceliaRun).toHaveBeenCalledTimes(1);
  });

  it('普通候选SQL排除Runner任务并要求未被有头执行者认领', async () => {
    const actual = await vi.importActual('../dispatch-helpers.js');
    mocks.query.mockResolvedValue({rows:[]});
    await actual.selectNextDispatchableTask(['goal-1']);
    const [sql,bindings]=mocks.query.mock.calls.find(([statement])=>/FROM tasks t\b/.test(statement));
    expect(sql).toContain('t.claimed_by IS NULL');
    expect(bindings.flat()).toContain('coding_workflow');
    expect(mocks.triggerCeceliaRun).not.toHaveBeenCalled();
  });

});
