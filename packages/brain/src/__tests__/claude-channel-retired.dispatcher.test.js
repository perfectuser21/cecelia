/**
 * Claude 无头通道下线 —— dispatcher 收口（任务 76a160b3）
 *
 * claude 桥接路径退役后，派前不预测路由（checkCeceliaRunAvailable(task) 恒可用），拦截只在执行时：
 *   - executor 返回 reason=claude_channel_retired → 按 no_executor 收口：回 queued、释放 claim、
 *     记入 noExecutorSkipIds，同一 tick 换下一个候选继续派
 *   - 绝不写 failed_dispatch / 不计 cecelia-run 熔断器 / dispatch_fail_autoblock / consecutive_failures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// llm-capacity 自 2026-09-22 起会去读 ops_model_accounts（codex/grok 的可用性
// 从本机凭据文件改为走配额账本）。本文件的 mockQuery 是**按调用顺序**排队响应的
// （mockResolvedValueOnce），多出来的那次账本查询会把后面全部错位 —— 而本文件
// 测的是派发收口，跟容量快照无关。直接把容量模块整个 mock 掉，别让它碰 db。
vi.mock('../llm-capacity.js', () => ({
  getLlmCapacitySnapshot: vi.fn().mockResolvedValue({
    sampled_at: '2026-09-22T00:00:00.000Z',
    sentinel: 'ok',
    healthy: true,
    errors: [],
    vendors: {
      claude: { vendor: 'claude', available_count: 2, total_count: 2, poller: 'ok', error: null, accounts: [] },
      codex: { vendor: 'codex', available_count: 5, total_count: 5, poller: 'ok', error: null, accounts: [] },
      grok: { vendor: 'grok', available_count: 1, total_count: 1, poller: 'ok', error: null, accounts: [] },
    },
  }),
  summarizeLlmCapacity: vi.fn((s) => s),
  chooseGuidedExecutor: vi.fn(() => ({ executor: 'claude', level: 'L1_primary_claude', reason: 'primary_vendor_available' })),
  clearLlmCapacityCache: vi.fn(),
  CODEX_ACCOUNTS: [],
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
  // harness admission 收权后（beeba317）dispatcher 会调 harnessSlotCheck；
  // 本文件测的是 bridge guard bypass，admission 直接放行
  harnessSlotCheck: vi.fn().mockResolvedValue({
    allow: true, reason: 'ok', containers: 0, inflight: 0,
    cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false,
  }),
}));

const mockIsAllowed = vi.fn().mockReturnValue(true);
const mockRecordFailure = vi.fn();
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
  recordSuccess: vi.fn(),
  recordFailure: (...args) => mockRecordFailure(...args),
  getAllStates: vi.fn().mockReturnValue({})
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));

const mockTriggerCeceliaRun = vi.fn();
const mockCheckAvailable = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckAvailable(...args),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn().mockReturnValue(0),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn()
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined)
}));

const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

const mockHandleTaskFailure = vi.fn();
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: (...args) => mockHandleTaskFailure(...args),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([])
}));

// quota-guard: fail-open（不限制优先级），避免测试 DB 调用干扰 mock 序列
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));

// account-usage: mock proactiveTokenCheck 避免真实 DB 调用消耗 mock 序列
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
  selectBestAccount: vi.fn().mockResolvedValue({ account: 'account2', model: 'claude-sonnet-4-6' }),
  getAccountUsage: vi.fn().mockResolvedValue([]),
  refreshUsageCache: vi.fn().mockResolvedValue(undefined),
  markAuthFailure: vi.fn().mockResolvedValue(undefined),
  getAuthFailedAccounts: vi.fn().mockReturnValue([]),
}));


const TASK = {
  id: 'task-claude-bound', title: 'Claude bound task title',
  description: '依赖 claude 桥接的任务，应被跳过而不是记失败',
  status: 'queued', priority: 'P1', payload: {},
  created_at: '2026-07-16T00:00:00Z', // 锚点执法闸上线前的存量任务，豁免 anchor 校验
};

function queueOneCandidate() {
  mockQuery.mockResolvedValueOnce({ rows: [] });        // drain retired harness types
  mockQuery.mockResolvedValueOnce({ rows: [TASK] });    // selectNextDispatchableTask
  mockQuery.mockResolvedValueOnce({ rows: [] });        // 派发前语义查重
  mockQuery.mockResolvedValueOnce({ rows: [{ id: TASK.id }] }); // atomic claim
  mockQuery.mockResolvedValueOnce({ rows: [TASK] });    // SELECT * FROM tasks
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
}

// 按 SQL 应答的候选队列：selectNextDispatchableTask 返回第一个未被跳过的；claude 候选执行时被拒，其它成功
function serveQueue(queue) {
  const byId = Object.fromEntries(queue.map(t => [t.id, t]));
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (/FROM tasks t\b/.test(text)) {
      const excluded = params.find(p => Array.isArray(p) && p.some(v => byId[v])) || [];
      const next = queue.find(t => !excluded.includes(t.id));
      return { rows: next ? [next] : [] };
    }
    if (/SET claimed_by = \$1/.test(text)) return { rows: [{ id: params[1] }], rowCount: 1 };
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(text)) return { rows: [byId[params[0]]], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  mockTriggerCeceliaRun.mockImplementation(async (t) => (t.id === TASK.id
    ? { success: false, taskId: t.id, reason: 'claude_channel_retired', error: 'claude_channel_retired' }
    : { success: true, taskId: t.id, runId: `run-${t.id}` }));
}

const autoblockWrites = () => mockQuery.mock.calls.filter(([sql]) => /dispatch_fail_consecutive/.test(String(sql)));
const failedDispatchEvents = () => mockQuery.mock.calls.filter(([sql, params]) => /INSERT INTO task_events/.test(String(sql)) && params?.[1] === 'failed_dispatch');

describe('dispatcher：claude 通道退役按 no_executor 收口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCheckAvailable.mockResolvedValue({ available: true });
  });

  it('派前可用性检查传入候选任务（恒可用，不预测路由）', async () => {
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, taskId: TASK.id, runId: 'run-1' });
    queueOneCandidate();

    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask(['goal-1']);

    expect(mockCheckAvailable).toHaveBeenCalledWith(expect.objectContaining({ id: TASK.id }));
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({ id: TASK.id }));
  });

  it('executor 返回 claude_channel_retired → no_executor 收口，释放 claim，不计熔断/autoblock', async () => {
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: false, taskId: TASK.id, reason: 'claude_channel_retired', error: 'claude_channel_retired' });
    queueOneCandidate();

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result).toMatchObject({ dispatched: false, reason: 'no_executor', no_executor_skipped: 1 });
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(autoblockWrites()).toHaveLength(0);
    expect(failedDispatchEvents()).toHaveLength(0);
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: TASK.id, status: 'queued' });
    expect(mockQuery.mock.calls.some(([sql, params]) => /SET claimed_by = NULL, claimed_at = NULL/.test(String(sql)) && params?.[0] === TASK.id)).toBe(true);
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'no_executor', undefined, TASK.id);
  });

  it('完整 dispatchNextTask：claude 候选 in_progress 后被拒 → 回 queued、无失败计数，同 tick 派出下一个 codex 候选', async () => {
    const CODEX = { ...TASK, id: 'task-codex-next', title: 'Codex next task title', task_type: 'codex_dev', payload: { executor: 'codex' } };
    const queue = [TASK, CODEX];
    serveQueue(queue);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    // 同一 tick 继续处理下一个非 claude 候选并派出
    expect(result).toMatchObject({ dispatched: true, task_id: CODEX.id });
    expect(mockTriggerCeceliaRun.mock.calls.map(([t]) => t.id)).toEqual([TASK.id, CODEX.id]);
    // claude 候选：先标 in_progress，被拒后回 queued 并释放 claim，不卡在 in_progress
    const statusUpdates = mockUpdateTask.mock.calls.map(([a]) => a).filter(a => a.task_id === TASK.id).map(a => a.status);
    expect(statusUpdates).toEqual(['in_progress', 'queued']);
    expect(mockQuery.mock.calls.some(([sql, params]) => /SET claimed_by = NULL, claimed_at = NULL/.test(String(sql)) && params?.[0] === TASK.id)).toBe(true);
    // 无任何失败计数
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(autoblockWrites()).toHaveLength(0);
    expect(failedDispatchEvents()).toHaveLength(0);
    expect(mockHandleTaskFailure).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /consecutive_failures/.test(String(sql)))).toBe(false);
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'no_executor', undefined, TASK.id);
    expect(mockRecordDispatchResult).not.toHaveBeenCalledWith(expect.anything(), false, 'executor_failed', undefined, TASK.id);
  });

  it('完整 dispatchNextTask：claude 候选被拒后下一个是 qiumi 候选 → 同 tick 派出 qiumi', async () => {
    // 上一 tick 已路由过的秋米单（路由幂等）：直接 proceed 到 trigger，不再打路由器
    const QIUMI = { ...TASK, id: 'task-qiumi-next', title: 'Qiumi next task title', task_type: 'qiumi_task', payload: { qiumi_route: { engine: 'terra' }, run_id: 'run-q' } };
    const queue = [TASK, QIUMI];
    serveQueue(queue);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(mockTriggerCeceliaRun.mock.calls.map(([t]) => t.id)).toEqual([TASK.id, QIUMI.id]);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(QIUMI.id);
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: TASK.id, status: 'queued' });
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(failedDispatchEvents()).toHaveLength(0);
  });
});
