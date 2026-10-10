/**
 * Claude 无头通道下线 —— dispatcher 收口（任务 76a160b3）
 *
 * claude 桥接路径退役后，派发器必须走既有「executor 不可用 → 跳过换下一个候选」（no_executor）语义：
 *   - checkCeceliaRunAvailable 按候选任务判定（传入 task），claude 路径返回 claude_channel_retired
 *   - executor 兜底返回 reason=claude_channel_retired 时同样按 no_executor 收口
 *   - 二者都绝不计入 cecelia-run 熔断器 / dispatch 失败计数 / dispatch_fail_autoblock
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

const autoblockWrites = () => mockQuery.mock.calls.filter(([sql]) => /dispatch_fail_consecutive/.test(String(sql)));
const failedDispatchEvents = () => mockQuery.mock.calls.filter(([sql, params]) => /INSERT INTO task_events/.test(String(sql)) && params?.[1] === 'failed_dispatch');

describe('dispatcher：claude 通道退役按 no_executor 收口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCheckAvailable.mockResolvedValue({ available: true });
  });

  it('可用性检查按候选任务判定，claude 路径 → no_executor 跳过，不计熔断/失败/autoblock', async () => {
    mockCheckAvailable.mockResolvedValue({ available: false, error: 'claude_channel_retired', retired: true });
    queueOneCandidate();

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(mockCheckAvailable).toHaveBeenCalledWith(expect.objectContaining({ id: TASK.id }));
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_executor');
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(autoblockWrites()).toHaveLength(0);
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: TASK.id, status: 'queued' });
    expect(mockRecordDispatchResult).not.toHaveBeenCalledWith(expect.anything(), false, 'executor_failed', undefined, TASK.id);
  });

  it('executor 返回 claude_channel_retired → no_executor 收口，释放 claim，不计熔断/autoblock', async () => {
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: false, taskId: TASK.id, reason: 'claude_channel_retired', error: 'claude_channel_retired' });
    queueOneCandidate();

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result).toMatchObject({ dispatched: false, reason: 'no_executor', task_id: TASK.id });
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(autoblockWrites()).toHaveLength(0);
    expect(failedDispatchEvents()).toHaveLength(0);
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: TASK.id, status: 'queued' });
    expect(mockQuery.mock.calls.some(([sql, params]) => /SET claimed_by = NULL, claimed_at = NULL/.test(String(sql)) && params?.[0] === TASK.id)).toBe(true);
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'no_executor', undefined, TASK.id);
  });
});
