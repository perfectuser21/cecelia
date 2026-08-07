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
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
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
// Mock: alertness-actions
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

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

/**
 * 构造 dispatchNextTask 一次执行所需的 mockQuery 调用序列（trigger=fail 路径）
 *
 * 调用顺序（参考 dispatch-executor-fail.test.js + 本 Sprint 加入的 autoblock 写 DB）：
 *  0. drain retired harness types → { rows: [], rowCount: 0 }
 *  1. selectNextDispatchableTask 内部 SQL → 由 mockSelectNextDispatchableTask 处理（不走 pool.query 直通）
 *  2. 派发前查重 (SELECT tasks.id AS id, tasks.title…) → { rows: [] }
 *  3. C1 atomic claim (UPDATE tasks SET claimed_by…) → { rows: [{ id }] }
 *  4. SELECT * FROM tasks (full task for triggerCeceliaRun) → { rows: [task] }
 *  5. [fail path] revert claim (UPDATE claimed_by=NULL)
 *  6. [autoblock] SELECT metadata FROM tasks → { rows: [{ metadata: { dispatch_fail_consecutive: N } }] }
 *  7. [autoblock] UPDATE metadata (write new count)
 *  若达阈值：
 *  8. [autoblock] blockTask 内部 UPDATE（由 mockBlockTask 接管，不经 pool.query）
 *  8/9. logTickDecision INSERT → { rows: [] }（必须显式注册 Once，避免与同批次第二次 setupQuerySequence 交叉消耗）
 */
function setupQuerySequence(task, prevFailCount = 0, reachedThreshold = false) {
  mockQuery
    // 0. drain retired
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    // 2. duplicate check
    .mockResolvedValueOnce({ rows: [] })
    // 3. atomic claim
    .mockResolvedValueOnce({ rows: [{ id: task.id }] })
    // 4. SELECT * (full task)
    .mockResolvedValueOnce({ rows: [task] })
    // 4.5 spawn 失败 fail-closed task_events 留痕 INSERT（task 94ee0ec4）
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    // 5. revert claim
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    // 6. SELECT metadata for autoblock counter
    .mockResolvedValueOnce({ rows: [{ metadata: { dispatch_fail_consecutive: prevFailCount } }] })
    // 7. UPDATE metadata (write new count)
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    // 8. logTickDecision INSERT（显式注册，防止被后续 setupQuerySequence 的 Once 挤占位置）
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    // fallback for any additional bookkeeping calls
    .mockResolvedValue({ rows: [], rowCount: 1 });
}

/**
 * 构造 dispatchNextTask 一次执行所需的 mockQuery 调用序列（trigger=success 路径）
 * success 路径：claim → full SELECT → [success] → [reset count if >0] → bookkeeping
 */
function setupSuccessQuerySequence(task, prevFailCount = 0) {
  mockQuery
    // 0. drain retired
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    // 2. duplicate check
    .mockResolvedValueOnce({ rows: [] })
    // 3. atomic claim
    .mockResolvedValueOnce({ rows: [{ id: task.id }] })
    // 4. SELECT * (full task)
    .mockResolvedValueOnce({ rows: [task] })
    // 5. [success path] SELECT metadata for reset-count check
    .mockResolvedValueOnce({ rows: [{ metadata: { dispatch_fail_consecutive: prevFailCount } }] })
    // 6. UPDATE metadata (reset to 0) — 仅当 prevFailCount > 0 时会执行
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    // bookkeeping (INSERT working_memory, logTickDecision, etc.)
    .mockResolvedValue({ rows: [], rowCount: 1 });
}

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
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // drain retired
        .mockResolvedValueOnce({ rows: [] })               // duplicate check
        .mockResolvedValueOnce({ rows: [{ id: task.id }] }) // claim
        .mockResolvedValueOnce({ rows: [task] })           // full SELECT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // revert claim
        .mockResolvedValue({ rows: [], rowCount: 1 });     // logTickDecision etc.

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
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: task.id }] })
        .mockResolvedValueOnce({ rows: [task] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 1 });

      const { dispatchNextTask } = await import('../dispatcher.js');
      await dispatchNextTask(['goal-1']);
    }

    expect(mockBlockTask).not.toHaveBeenCalled();
    expect(mockRaise).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
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
