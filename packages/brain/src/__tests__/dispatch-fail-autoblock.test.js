/**
 * dispatch-fail-autoblock.test.js
 *
 * GP-1～GP-5：dispatcher 坏任务自动隔离
 * Sprint: 07141332-dispatch-fail-autoblock
 * Task:   7c5d6df8-791c-4190-8db8-1274cef9071c
 *
 * DoD 映射：
 * - GP-1 [BEHAVIOR-1]  三连失败 → task.status='blocked', blocked_reason='dispatch_fail_autoblock', raise('P2') ×1
 * - GP-2 [BEHAVIOR-2]  blocked 任务不再入候选（下一 tick 派发 task B）
 * - GP-3 [BEHAVIOR-3]  成功派发重置 dispatch_fail_consecutive；再失败从 1 累计
 * - GP-4 [BEHAVIOR-4]  DISPATCH_FAIL_AUTOBLOCK_THRESHOLD env 覆盖（=2，失败 2 次即 block）
 * - GP-5 [BEHAVIOR-5]  configError 失败不计入计数，不触发 autoblock
 * - BEHAVIOR-6         spawn_deduplicated 失败不计入计数，不触发 autoblock
 * - BEHAVIOR-7         阈值非法值（NaN / <1）回退默认 3
 *
 * 规范：
 * - failing test 先 commit（Phase 1），实现后全绿（Phase 2）
 * - 不依赖真实 DB，不依赖真实 alerting 推送，全部 mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock: DB pool
// ─────────────────────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: slot-allocator（始终允许派发）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: false },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: circuit-breaker（始终 open）
// ─────────────────────────────────────────────────────────────────────────────
const mockIsAllowed = vi.fn().mockReturnValue(true);
const mockRecordFailure = vi.fn();
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
  recordSuccess: vi.fn(),
  recordFailure: (...args) => mockRecordFailure(...args),
  getAllStates: vi.fn().mockReturnValue({}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Mock: drain（未 draining）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../drain.js', () => ({
  isDraining: vi.fn().mockReturnValue(false),
  getDrainStartedAt: vi.fn().mockReturnValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: quota-cooling（不冷却）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn().mockReturnValue(false),
  getQuotaCoolingState: vi.fn().mockReturnValue({ until: null }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: quota-guard（通过）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: account-usage
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
  selectBestAccount: vi.fn().mockResolvedValue({ account: 'account1', model: 'claude-sonnet-4-6' }),
  getAccountUsage: vi.fn().mockResolvedValue([]),
  refreshUsageCache: vi.fn().mockResolvedValue(undefined),
  markAuthFailure: vi.fn().mockResolvedValue(undefined),
  getAuthFailedAccounts: vi.fn().mockReturnValue([]),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: executor
// ─────────────────────────────────────────────────────────────────────────────
const mockTriggerCeceliaRun = vi.fn();
const mockCheckCeceliaRunAvailable = vi.fn().mockResolvedValue({ available: true });
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckCeceliaRunAvailable(...args),
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
  killProcessTwoStage: vi.fn(),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: actions（updateTask）
// ─────────────────────────────────────────────────────────────────────────────
const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: task-updater（blockTask）
// ─────────────────────────────────────────────────────────────────────────────
const mockBlockTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../task-updater.js', () => ({
  blockTask: (...args) => mockBlockTask(...args),
  updateTaskStatus: vi.fn().mockResolvedValue({ success: true }),
  unblockTask: vi.fn().mockResolvedValue({ success: true }),
  unblockExpiredTasks: vi.fn().mockResolvedValue([]),
  broadcastTaskState: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: alerting（raise）
// ─────────────────────────────────────────────────────────────────────────────
const mockRaise = vi.fn();
vi.mock('../alerting.js', () => ({
  raise: (...args) => mockRaise(...args),
  flushP1: vi.fn(),
  flushP2: vi.fn(),
  flushAlertsIfNeeded: vi.fn(),
  getStatus: vi.fn().mockReturnValue({}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: dispatch-helpers（selectNextDispatchableTask）
// ─────────────────────────────────────────────────────────────────────────────
const mockSelectNextDispatchableTask = vi.fn();
const mockProcessCortexTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: (...args) => mockProcessCortexTask(...args),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: dispatch-dedup
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../dispatch-dedup.js', () => ({
  findDuplicateSibling: vi.fn().mockReturnValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: pre-flight-check（始终通过）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: event-bus
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: events/taskEvents
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: dispatch-stats
// ─────────────────────────────────────────────────────────────────────────────
const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: token-budget-planner
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../token-budget-planner.js', () => ({
  shouldDowngrade: vi.fn().mockReturnValue(false),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: tick-stats
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../tick-stats.js', () => ({
  incrementActionsToday: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: eviction（不触发驱逐）
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../eviction.js', () => ({
  findEvictionCandidate: vi.fn().mockResolvedValue(null),
  requeueEvictedTask: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock: watchdog
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../watchdog.js', () => ({
  cleanupMetrics: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 测试辅助：构造 task 对象
// ─────────────────────────────────────────────────────────────────────────────
function makeTask(overrides = {}) {
  return {
    id: 'task-autoblock-test',
    title: 'Research task that keeps failing dispatch',
    description: '触发 autoblock 的测试任务',
    status: 'queued',
    priority: 'P1',
    task_type: 'research',
    payload: {},
    metadata: {},
    project_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// 数据夹具按SQL语义响应；移除旧Harness查询不应改变普通任务的claim/计数结果。
const pendingDispatches = [];
let activeDispatch = null;
let preparedDispatches = 0;
const unexpectedSql = [];
beforeEach(() => {
  pendingDispatches.length = 0;
  unexpectedSql.length = 0;
  activeDispatch = null;
  preparedDispatches = 0;
  mockQuery.mockReset();
});
afterEach(() => {
  expect(pendingDispatches).toHaveLength(0);
  expect(unexpectedSql).toEqual([]);
  if (preparedDispatches) expect(mockTriggerCeceliaRun).toHaveBeenCalled();
});
function setupQuerySequence(task, prevFailCount = 0) {
  pendingDispatches.push({ task, prevFailCount });
  preparedDispatches++;
  mockQuery.mockImplementation(async (statement, values = []) => {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (/^UPDATE tasks SET claimed_by = \$1, claimed_at = NOW\(\)/.test(sql)) {
      activeDispatch = pendingDispatches.shift();
      if (!activeDispatch || values[1] !== activeDispatch.task.id) throw Error('unexpected_atomic_claim');
      return { rows: [{ id: activeDispatch.task.id }], rowCount: 1 };
    }
    if (/^SELECT \* FROM tasks WHERE id = \$1/.test(sql)) {
      if (!activeDispatch || values[0] !== activeDispatch.task.id) throw Error('unexpected_full_task_read');
      return { rows: [activeDispatch.task], rowCount: 1 };
    }
    if (/^SELECT metadata FROM tasks WHERE id = \$1/.test(sql)) {
      if (!activeDispatch || values[0] !== activeDispatch.task.id) throw Error('unexpected_metadata_read');
      return { rows: [{ metadata: { dispatch_fail_consecutive: activeDispatch.prevFailCount } }], rowCount: 1 };
    }
    if (/^SELECT tasks\.id AS id, tasks\.title AS title/.test(sql)) return { rows: [], rowCount: 0 };
    if (/^SELECT id, run_id FROM task_runs WHERE run_id = \$1/.test(sql)) {
      return { rows: [{ id: 'owned-run-ledger', run_id: values[0] }], rowCount: 1 };
    }
    if (/^(?:INSERT|UPDATE)\b/.test(sql)) return { rows: [], rowCount: 1 };
    unexpectedSql.push(sql);
    throw Error(`unexpected_test_sql: ${sql}`);
  });
}
const setupSuccessQuerySequence = setupQuerySequence;

// ─────────────────────────────────────────────────────────────────────────────
// GP-1 [BEHAVIOR-1]：三连失败 → 自动 blocked
// ─────────────────────────────────────────────────────────────────────────────
describe('GP-1 [BEHAVIOR-1]: 三连失败 → 自动 blocked', () => {
  const task = makeTask({ metadata: {} });

  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset 清除 Once 队列（vi.clearAllMocks 只清 calls，不清 Once 队列）
    mockSelectNextDispatchableTask.mockReset();
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false,
      error: 'payload missing callback_url',
      reason: 'bridge_error',
    });
    mockSelectNextDispatchableTask
      .mockResolvedValueOnce(task)  // tick 1
      .mockResolvedValueOnce(task)  // tick 2
      .mockResolvedValueOnce(task); // tick 3
  });

  it('第 1 次失败：dispatch_fail_consecutive 应写入 1，未触发 blockTask', async () => {
    setupQuerySequence(task, 0, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    // autoblock 未触发（仅第 1 次失败）
    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();
    // metadata 写入（count=1）
    const updateMetaCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('dispatch_fail_consecutive') && c[0].includes('UPDATE')
    );
    expect(updateMetaCall).toBeDefined();
  });

  it('第 2 次失败：dispatch_fail_consecutive 应写入 2，未触发 blockTask', async () => {
    setupQuerySequence(task, 1, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('第 3 次失败：触发 autoblock — blockTask 被调用，raise(P2) 被调用 1 次', async () => {
    setupQuerySequence(task, 2, true);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);

    // blockTask 调用断言
    expect(mockBlockTask).toHaveBeenCalledTimes(1);
    expect(mockBlockTask).toHaveBeenCalledWith(
      task.id,
      expect.objectContaining({
        reason: 'dispatch_fail_autoblock',
        detail: expect.objectContaining({
          consecutive_failures: 3,
        }),
      })
    );

    // raise('P2', ...) 仅调用 1 次
    expect(mockRaise).toHaveBeenCalledTimes(1);
    expect(mockRaise).toHaveBeenCalledWith(
      'P2',
      'dispatch_fail_autoblock',
      expect.stringContaining(task.id)
    );
  });

  it('第 3 次失败后 blocked_detail 含 last_error 和 blocked_at_tick', async () => {
    setupQuerySequence(task, 2, true);
    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask(['goal-1']);

    const blockCallArgs = mockBlockTask.mock.calls[0];
    expect(blockCallArgs[1].detail).toMatchObject({
      consecutive_failures: 3,
      last_error: expect.any(String),
      blocked_at_tick: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-2 [BEHAVIOR-2]：blocked 任务不再入候选
// ─────────────────────────────────────────────────────────────────────────────
describe('GP-2 [BEHAVIOR-2]: blocked 任务下一 tick 不再被选中', () => {
  const taskA = makeTask({ id: 'task-A-blocked', status: 'blocked' });
  const taskB = makeTask({ id: 'task-B-queued', title: 'Normal task B', status: 'queued' });

  beforeEach(() => {
    vi.clearAllMocks();
    // mockReset 清除 Once 队列（vi.clearAllMocks 只清 calls，不清 Once 队列）
    mockSelectNextDispatchableTask.mockReset();
    mockTriggerCeceliaRun.mockReset().mockResolvedValue({ success: false }); // 默认值
    // selectNextDispatchableTask 已过滤 blocked，直接返回 taskB
    mockSelectNextDispatchableTask.mockResolvedValueOnce(taskB);
    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: true,
      runId: 'run-B-001',
    });
  });

  it('selectNextDispatchableTask 应返回 task B（不是 blocked 的 task A）', async () => {
    setupSuccessQuerySequence(taskB, 0);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(taskB.id);
    expect(result.task_id).not.toBe(taskA.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-3 [BEHAVIOR-3]：成功派发重置连续计数
// ─────────────────────────────────────────────────────────────────────────────
describe('GP-3 [BEHAVIOR-3]: 成功派发重置 dispatch_fail_consecutive', () => {
  const task = makeTask({ metadata: { dispatch_fail_consecutive: 2 } });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('第 3 次（成功）：dispatch_fail_consecutive 应归零，task 状态 in_progress', async () => {
    mockSelectNextDispatchableTask.mockResolvedValueOnce(task);
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, runId: 'run-reset-001' });
    setupSuccessQuerySequence(task, 2);

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(mockBlockTask).not.toHaveBeenCalled();

    // 归零：UPDATE metadata dispatch_fail_consecutive=0 应被调用
    const resetCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' &&
        c[0].includes('dispatch_fail_consecutive') &&
        c[0].includes('UPDATE') &&
        // 值写入 0
        JSON.stringify(c[1] ?? c).includes('"dispatch_fail_consecutive":0')
    );
    expect(resetCall).toBeDefined();
  });

  it('成功后再失败 2 次：dispatch_fail_consecutive 应为 2，未触发 block', async () => {
    const taskFresh = makeTask({ metadata: { dispatch_fail_consecutive: 0 } });

    // 第 1 次失败
    mockSelectNextDispatchableTask
      .mockResolvedValueOnce(taskFresh)
      .mockResolvedValueOnce(taskFresh);
    mockTriggerCeceliaRun
      .mockResolvedValueOnce({ success: false, error: 'err', reason: 'bridge_error' })
      .mockResolvedValueOnce({ success: false, error: 'err', reason: 'bridge_error' });
    setupQuerySequence(taskFresh, 0, false);
    setupQuerySequence(taskFresh, 1, false);

    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask(['goal-1']); // fail#1 → count=1
    await dispatchNextTask(['goal-1']); // fail#2 → count=2

    // 未触发 blockTask
    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-4 [BEHAVIOR-4]：DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 环境变量覆盖
// ─────────────────────────────────────────────────────────────────────────────
describe('GP-4 [BEHAVIOR-4]: 阈值 env DISPATCH_FAIL_AUTOBLOCK_THRESHOLD=2', () => {
  const task = makeTask();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD = '2';
  });

  afterEach(() => {
    delete process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD;
    vi.resetModules(); // 重置模块缓存以使常量重新计算
  });

  it('阈值=2：失败 2 次即触发 autoblock', async () => {
    // 注意：DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 是模块级常量，需在 vi.resetModules() 后
    // 重新 import 才能生效。
    // 关键：vi.clearAllMocks() 不清除 mockResolvedValueOnce 的 Once 队列，
    // 因此两次 dispatchNextTask 调用之间必须分批注册 setupQuerySequence，
    // 不能提前一次性注册两批（否则第一次 dispatch 的 logTickDecision 会消耗第二批的 drain Once）。
    mockTriggerCeceliaRun
      .mockResolvedValue({ success: false, error: 'err', reason: 'bridge_error' });

    // 重新 import 以读取新 env（THRESHOLD=2）
    vi.resetModules();
    const { dispatchNextTask } = await import('../dispatcher.js');

    // fail#1：只提前注册第一次的 query 序列
    mockSelectNextDispatchableTask.mockReset().mockResolvedValueOnce(task);
    setupQuerySequence(task, 0, false); // fail#1 → count=1（未达阈值 2）
    await dispatchNextTask(['goal-1']); // fail#1

    vi.clearAllMocks();
    // fail#2：重新注册 mock 和 query 序列
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'err', reason: 'bridge_error' });
    mockSelectNextDispatchableTask.mockReset().mockResolvedValueOnce(task);
    setupQuerySequence(task, 1, true); // fail#2 → count=2 → block（达阈值 2）
    await dispatchNextTask(['goal-1']); // fail#2

    expect(mockBlockTask).toHaveBeenCalledTimes(1);
    expect(mockRaise).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GP-5 [BEHAVIOR-5]：configError 不计入连续计数，不触发 autoblock
// ─────────────────────────────────────────────────────────────────────────────
describe('GP-5 [BEHAVIOR-5]: configError 失败不计入计数', () => {
  const task = makeTask();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false,
      configError: true,
      reason: 'no_codex_cli',
      error: 'Codex CLI not found',
    });
  });

  it('configError 连续 3 次：dispatch_fail_consecutive 不写入，task 不 blocked', async () => {
    mockSelectNextDispatchableTask
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task);

    // configError 路径：不走 autoblock 分支，也不调 recordFailure
    // 但仍走 revert claim 路径，query 序列比 fail 路径少 autoblock 的 2 次 SELECT/UPDATE
    for (let i = 0; i < 3; i++) {
      setupQuerySequence(task);

      const { dispatchNextTask } = await import('../dispatcher.js');
      await dispatchNextTask(['goal-1']);
    }

    // 关键断言：
    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();

    // dispatch_fail_consecutive 的写入 SQL 不应出现（configError 路径跳过计数）
    const anyCountWrite = mockQuery.mock.calls.some(
      (c) => typeof c[0] === 'string' &&
        c[0].includes('dispatch_fail_consecutive') &&
        c[0].includes('UPDATE')
    );
    expect(anyCountWrite).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [BEHAVIOR-6]：spawn_deduplicated 不计入连续计数
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-6]: spawn_deduplicated 失败不计入计数', () => {
  const task = makeTask();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false,
      reason: 'spawn_deduplicated',
    });
  });

  it('spawn_deduplicated 连续 3 次：dispatch_fail_consecutive 不写入，task 不 blocked', async () => {
    mockSelectNextDispatchableTask
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(task);

    for (let i = 0; i < 3; i++) {
      setupQuerySequence(task);

      const { dispatchNextTask } = await import('../dispatcher.js');
      await dispatchNextTask(['goal-1']);
    }

    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();
  });
});

// [BEHAVIOR-7]：阈值非法值回退默认 3
// ─────────────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-7]: DISPATCH_FAIL_AUTOBLOCK_THRESHOLD 非法值回退默认 3', () => {
  afterEach(() => {
    delete process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD;
    vi.resetModules();
  });

  it('THRESHOLD=abc（NaN）→ 回退 3：失败 2 次不 block，第 3 次 block', async () => {
    process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD = 'abc';
    vi.resetModules();

    const task = makeTask();
    vi.clearAllMocks();

    // 关键：必须分批注册 setupQuerySequence（每次 dispatch 前只注册当次的序列），
    // 避免 vi.clearAllMocks() 不清除 Once 队列导致的交叉消耗。
    const { dispatchNextTask } = await import('../dispatcher.js');

    // fail#1
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'err', reason: 'bridge_error' });
    mockSelectNextDispatchableTask.mockReset().mockResolvedValueOnce(task);
    setupQuerySequence(task, 0, false);
    await dispatchNextTask(['goal-1']); // count=1

    vi.clearAllMocks();
    // fail#2
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'err', reason: 'bridge_error' });
    mockSelectNextDispatchableTask.mockReset().mockResolvedValueOnce(task);
    setupQuerySequence(task, 1, false);
    await dispatchNextTask(['goal-1']); // count=2 → 不 block
    expect(mockBlockTask).not.toHaveBeenCalled();

    vi.clearAllMocks();
    // fail#3
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'err', reason: 'bridge_error' });
    mockSelectNextDispatchableTask.mockReset().mockResolvedValueOnce(task);
    setupQuerySequence(task, 2, true);
    await dispatchNextTask(['goal-1']); // count=3 → block
    expect(mockBlockTask).toHaveBeenCalledTimes(1);
  });

  it('THRESHOLD=0（< 1）→ 回退 3：行为同上', async () => {
    process.env.DISPATCH_FAIL_AUTOBLOCK_THRESHOLD = '0';
    vi.resetModules();

    const { DISPATCH_FAIL_AUTOBLOCK_THRESHOLD } = await import('../dispatcher.js');
    expect(DISPATCH_FAIL_AUTOBLOCK_THRESHOLD).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reason_code 与 needs_rebase 停车（任务 d9c405e2）
//
// 预检重锚定在「分支已有产出但 base_sha 落后地图」时抛 code='needs_rebase'，
// 这不是执行故障——不应累计 dispatch_fail_consecutive、不应走三振 autoblock，
// 而是直接停车（blocked reason='needs_rebase'）等 rebase 后解锁。
// 同时所有派发失败的 detail / task_events 都带结构化 reason_code，便于回填与归因。
// ─────────────────────────────────────────────────────────────────────────────
describe('reason_code 与 needs_rebase（任务 d9c405e2）', () => {
  // 与本文件其余用例一致用默认 task_type（research）：harness_initiative 在本文件的
  // slot-allocator mock 下（codex.available=false）会被 HOL skip，根本走不到派发失败路径。
  const task = makeTask({ metadata: {} });

  beforeEach(() => {
    vi.clearAllMocks();
    // vi.clearAllMocks 不清 Once 队列：本 describe 下多个用例各自注册 setupQuerySequence，
    // 不 reset 会让上一条用例的残留 Once 顶掉下一条的 claim 结果（表现为 already_claimed）。
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockBlockTask.mockReset().mockResolvedValue({ success: true });
    mockSelectNextDispatchableTask.mockResolvedValueOnce(task);
  });

  it('三振时 blockTask detail 带 reason_code=map_revision_mismatch', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, reason: 'kernel_authority_not_created', error: 'map_revision_mismatch' });
    setupQuerySequence(task, 2, true);
    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask(['goal-1']);
    expect(mockBlockTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      reason: 'dispatch_fail_autoblock',
      detail: expect.objectContaining({ reason_code: 'map_revision_mismatch', consecutive_failures: 3 }),
    }));
  });

  it('needs_rebase：直接 block（reason=needs_rebase）、不累计 dispatch_fail_consecutive、P3 告警', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false, reason: 'needs_rebase', reason_code: 'needs_rebase', error: 'needs_rebase',
      detail: { old_base_sha: 'a'.repeat(40), new_base_sha: 'b'.repeat(40), branch: 'cp-route-api-1' },
    });
    setupQuerySequence(task, 0, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);
    expect(result.dispatched).toBe(false);
    // 停车不是执行故障：统计口径与返回体 reason 都用 needs_rebase，不混进 executor_failed
    expect(result.reason).toBe('needs_rebase');
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'needs_rebase', undefined, task.id);
    expect(mockBlockTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      reason: 'needs_rebase',
      detail: expect.objectContaining({ reason_code: 'needs_rebase', branch: 'cp-route-api-1' }),
    }));
    const countUpdate = mockQuery.mock.calls.find(([sql]) => /dispatch_fail_consecutive/.test(String(sql)) && /UPDATE tasks/.test(String(sql)));
    expect(countUpdate).toBeUndefined();
    // 也不能计入共享的 cecelia-run 熔断器（否则停车会连累其他任务类型派不出去）
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockRaise).toHaveBeenCalledWith('P3', 'needs_rebase', expect.stringContaining(task.id));
  });

  it('reason 未标 needs_rebase 但 reason_code 是：同样停车，detail 里的 reason_code 不能覆盖停车码', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false, reason: 'kernel_authority_not_created', reason_code: 'needs_rebase', error: 'needs_rebase',
      // detail 自带一个陈旧 reason_code：展开后必须被停车码压掉，不能反向覆盖
      detail: { branch: 'cp-route-api-2', reason_code: 'stale_value' },
    });
    setupQuerySequence(task, 0, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);
    expect(result.reason).toBe('needs_rebase');
    expect(mockBlockTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      reason: 'needs_rebase',
      detail: expect.objectContaining({ reason_code: 'needs_rebase', branch: 'cp-route-api-2' }),
    }));
    const countUpdate = mockQuery.mock.calls.find(([sql]) => /dispatch_fail_consecutive/.test(String(sql)) && /UPDATE tasks/.test(String(sql)));
    expect(countUpdate).toBeUndefined();
  });

  it('blockTask 没停住（返回 success:false）→ P2 needs_rebase_park_failed，不静默', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false, reason: 'needs_rebase', reason_code: 'needs_rebase', error: 'needs_rebase',
      detail: { branch: 'cp-route-api-3' },
    });
    // blockTask 不抛异常，失败时返回 {success:false}；WHERE status IN(...) 不匹配也走这条路径。
    // 任务因此仍留在 queued，会每 tick 重撞——必须告警让人看见。
    mockBlockTask.mockResolvedValueOnce({ success: false, error: 'Task not found or not in blockable state' });
    setupQuerySequence(task, 0, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask(['goal-1']);
    expect(mockRaise).toHaveBeenCalledWith('P2', 'needs_rebase_park_failed', expect.stringContaining(task.id));
  });
});
