/**
 * TDD: pre-flight 三振持久终结
 *
 * Bug: description 为空的任务每 2 分钟被重选重拒，无持久后果，导致 P0 告警轰炸（07-10 任务 65f0a482，64 次）
 * Fix: metadata 累加 pre_flight_fail_count；第 3 次拒绝时置 status=blocked，blocked_reason=pre_flight_rejected
 * Revival: PATCH description 时若 blocked_reason=pre_flight_rejected 自动清零并回 queued
 *
 * DoD:
 * - 第 1/2 次拒绝：metadata.pre_flight_fail_count 递增，status 仍 queued
 * - 第 3 次拒绝：status=blocked，blocked_reason=pre_flight_rejected，blocked_detail 含 issues/suggestions/strikes
 * - blocked 后不再入候选（selectNextDispatchableTask 只选 queued，自然止血）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  }),
  shouldBypassBackpressure: vi.fn(() => false),
}));

vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({})
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true })
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, runId: 'run-123' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
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

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../tick-stats.js', () => ({
  incrementActionsToday: vi.fn().mockResolvedValue(1),
  recordTickExecution: vi.fn().mockResolvedValue(undefined),
}));

const mockPreFlightCheck = vi.fn();
const mockAlertOnPreFlightFail = vi.fn().mockResolvedValue(undefined);

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: (...args) => mockPreFlightCheck(...args),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: (...args) => mockAlertOnPreFlightFail(...args),
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

// ──────────────────────────────────────────────────────────
// Helper: 构造 queryMock 序列，供"单 tick 派发"调用
// 每次 dispatchNextTask 调用需要:
//   [0] drain retired harness types
//   [1] selectNextDispatchableTask → [task]
//   [2] UPDATE metadata (三振相关)
//   [3] selectNextDispatchableTask → [] (no more candidates)
// ──────────────────────────────────────────────────────────
function setupSingleTickReject(task) {
  mockQuery.mockResolvedValueOnce({ rows: [] });           // [0] drain retired
  mockQuery.mockResolvedValueOnce({ rows: [task] });       // [1] select → task
  mockQuery.mockResolvedValueOnce({ rowCount: 1 });        // [2] UPDATE metadata/blocked
  mockQuery.mockResolvedValueOnce({ rows: [] });           // [3] select → empty
}

describe('dispatcher: pre-flight 三振持久终结', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreFlightCheck.mockResolvedValue({
      passed: false,
      issues: ['description is empty'],
      suggestions: ['Fill in the description field']
    });
  });

  it('第 1 次拒绝：metadata 写入 pre_flight_fail_count=1，status 保持 queued', async () => {
    const task = {
      id: 'task-strikes-1', title: 'Task with no description', description: null,
      prd_content: null, status: 'queued', priority: 'P1', payload: {},
      metadata: null
    };
    setupSingleTickReject(task);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);

    // 找到 UPDATE metadata 的那次调用（单行 SQL）
    const updateCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes('metadata')
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const metaCall = updateCalls[0];
    expect(metaCall).toBeDefined();
    const metaArg = JSON.parse(metaCall[1][1]);
    expect(metaArg.pre_flight_fail_count).toBe(1);
    // 不应该置 blocked
    expect(metaCall[0]).not.toContain("status = 'blocked'");
    expect(metaCall[0]).not.toContain('blocked_reason');
  });

  it('第 2 次拒绝（metadata 有 count=1）：count 更新为 2，status 保持 queued', async () => {
    const task = {
      id: 'task-strikes-2', title: 'Task with no description', description: null,
      prd_content: null, status: 'queued', priority: 'P1', payload: {},
      metadata: { pre_flight_fail_count: 1 }
    };
    setupSingleTickReject(task);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);

    const updateCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes('metadata')
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const metaCall = updateCalls[0];
    expect(metaCall).toBeDefined();
    const metaArg = JSON.parse(metaCall[1][1]);
    expect(metaArg.pre_flight_fail_count).toBe(2);
    expect(metaCall[0]).not.toContain("status = 'blocked'");
  });

  it('第 3 次拒绝（metadata 有 count=2）：置 blocked，blocked_reason=pre_flight_rejected', async () => {
    const task = {
      id: 'task-strikes-3', title: 'Task with no description', description: null,
      prd_content: null, status: 'queued', priority: 'P1', payload: {},
      metadata: { pre_flight_fail_count: 2 }
    };
    setupSingleTickReject(task);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);

    // 必须有包含 blocked_reason 的 UPDATE 调用
    const allUpdateCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes('blocked')
    );
    expect(allUpdateCalls.length).toBeGreaterThanOrEqual(1);
    const blockedCall = allUpdateCalls[0];

    // blocked_reason 必须是 pre_flight_rejected
    const sql = blockedCall[0];
    expect(sql).toContain('blocked_reason');

    // blocked_detail 参数（JSON 字符串）必须含 strikes=3 和 issues
    const detailArg = blockedCall[1].find(a => {
      try { const p = typeof a === 'string' ? JSON.parse(a) : a; return p?.strikes !== undefined; } catch { return false; }
    });
    expect(detailArg).toBeDefined();
    const detail = typeof detailArg === 'string' ? JSON.parse(detailArg) : detailArg;
    expect(detail.strikes).toBe(3);
    expect(detail.issues).toContain('description is empty');
    expect(detail.suggestions).toContain('Fill in the description field');
  });

  it('第 3 次拒绝后只告警一次（告警自然止血）', async () => {
    const task = {
      id: 'task-strikes-alert', title: 'Task with no description', description: null,
      prd_content: null, status: 'queued', priority: 'P1', payload: {},
      metadata: { pre_flight_fail_count: 2 }
    };
    setupSingleTickReject(task);

    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask(['goal-1']);

    // alertOnPreFlightFail 被调用正好一次（blocked 后不再入候选，告警自然止血）
    expect(mockAlertOnPreFlightFail).toHaveBeenCalledTimes(1);
  });
});
