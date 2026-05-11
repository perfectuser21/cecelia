/**
 * Cortex Insight learning_id=c8b0160f-709b-483c-bc49-384df2691809:
 *   "Executor preflight 是 dispatcher 零成本最高价值防御，一次 ping 阻止
 *    整个断联期间的所有僵尸任务"
 *
 * 历史问题：
 *   `checkCeceliaRunAvailable()` 原本在 dispatchNextTask 第 5 步、紧跟着
 *   "标记 in_progress" 之后才调用。bridge 断联时每个 tick 触发：
 *     1) 抢 task (atomic claim 写 claimed_by)
 *     2) UPDATE status='in_progress'
 *     3) ping → fail
 *     4) UPDATE status='queued' (revert)
 *     5) UPDATE claimed_by=NULL (release claim)
 *   即 4 次 DB 写 + 1 次短暂 zombie 窗口。bridge 离线 1 小时 = 数百次浪费。
 *
 * 修复：把 bridge ping 提到 dispatch 头部（circuit breaker 之后、retired drain
 * 之前），bridge 不可用时直接 return executor_offline，不抢 task、不改 status、
 * 不写 DB（除 dispatch_stats，跟其它 skip-check 路径风格一致）。
 *
 * DoD：
 * - 给定 checkCeceliaRunAvailable 返 {available:false}
 *   - dispatch 返 {dispatched:false, reason:'executor_offline'}
 *   - 没有 atomic claim SQL（不含 `claimed_by = $1`）
 *   - 没有 in_progress 状态写（updateTask 不被调用）
 * - 给定 checkCeceliaRunAvailable 返 {available:true} → 走正常路径
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 3 },
    budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));

const mockCheckCeceliaRunAvailable = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, runId: 'run-123' }),
  checkCeceliaRunAvailable: (...args) => mockCheckCeceliaRunAvailable(...args),
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
  publishExecutorStatus: vi.fn(),
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));

const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));

vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
  selectBestAccount: vi.fn().mockResolvedValue({ account: 'account2', model: 'claude-sonnet-4-6' }),
  getAccountUsage: vi.fn().mockResolvedValue([]),
  refreshUsageCache: vi.fn().mockResolvedValue(undefined),
  markAuthFailure: vi.fn().mockResolvedValue(undefined),
  getAuthFailedAccounts: vi.fn().mockReturnValue([]),
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn().mockReturnValue(false),
  getQuotaCoolingState: vi.fn().mockReturnValue({}),
}));

vi.mock('../drain.js', () => ({
  isDraining: vi.fn().mockReturnValue(false),
  getDrainStartedAt: vi.fn().mockReturnValue(null),
}));

vi.mock('../token-budget-planner.js', () => ({
  shouldDowngrade: vi.fn().mockReturnValue(false),
}));

vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: vi.fn().mockResolvedValue(null),
  processCortexTask: vi.fn().mockResolvedValue({ dispatched: false }),
}));

describe('dispatchNextTask: executor preflight at top of dispatch (zombie defense)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCeceliaRunAvailable.mockReset();
    mockUpdateTask.mockClear();
    mockRecordDispatchResult.mockClear();
    mockQuery.mockReset();
  });

  it('bridge 不可用时 dispatch 立刻退场，不抢 task / 不写 in_progress', async () => {
    mockCheckCeceliaRunAvailable.mockResolvedValueOnce({
      available: false,
      path: 'http://localhost:3457',
      error: 'Bridge not running',
    });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('executor_offline');
    expect(result.detail).toContain('Bridge not running');

    // 零侧效应：不调 updateTask，不跑 atomic claim SQL
    expect(mockUpdateTask).not.toHaveBeenCalled();
    const claimCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('claimed_by = $1')
    );
    expect(claimCall).toBeUndefined();

    // dispatch_stats 记一笔 executor_offline，跟 billing/quota/circuit 其它 skip 路径一致
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'executor_offline');
  });

  it('bridge 可用时正常进入 dispatch 主路径（selectNextDispatchableTask 被调）', async () => {
    mockCheckCeceliaRunAvailable.mockResolvedValueOnce({
      available: true,
      path: 'http://localhost:3457',
      bridge: true,
    });

    // Phase 2.5 drain retired query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');
    const { dispatchNextTask } = await import('../tick.js');

    const result = await dispatchNextTask(['goal-1']);

    expect(mockCheckCeceliaRunAvailable).toHaveBeenCalledTimes(1);
    expect(selectNextDispatchableTask).toHaveBeenCalled();
    // selectNextDispatchableTask mock 返 null → no_dispatchable_task
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_dispatchable_task');
  });

  it('多 tick 期间 bridge 持续离线 → 每次 ping 1 次、不发起任何 SQL 写', async () => {
    mockCheckCeceliaRunAvailable.mockResolvedValue({
      available: false,
      path: 'http://localhost:3457',
      error: 'Timeout',
    });

    const { dispatchNextTask } = await import('../tick.js');

    for (let i = 0; i < 5; i++) {
      const r = await dispatchNextTask(['goal-1']);
      expect(r.reason).toBe('executor_offline');
    }

    expect(mockCheckCeceliaRunAvailable).toHaveBeenCalledTimes(5);
    expect(mockUpdateTask).not.toHaveBeenCalled();
    // 不应触发任何 tasks 表 UPDATE
    const taskWrites = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && /UPDATE\s+tasks\b/i.test(c[0])
    );
    expect(taskWrites.length).toBe(0);
  });
});
