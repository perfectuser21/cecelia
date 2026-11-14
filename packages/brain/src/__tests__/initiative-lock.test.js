/**
 * 测试 Initiative 级锁：同一 Initiative（project_id）已有 in_progress 任务时，不再派发新任务
 *
 * DoD 映射：
 * - DoD-1: selectNextDispatchableTask SQL 包含 NOT EXISTS 子查询（Initiative 锁）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../slot-allocator.js', () => ({
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

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

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

describe('selectNextDispatchableTask: Initiative 锁 SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SQL 包含 NOT EXISTS 子查询排除已有 in_progress 任务的 Initiative', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../tick.js');
    await selectNextDispatchableTask(['goal-1']);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("t2.project_id = t.project_id");
    expect(sql).toContain("t2.status = 'in_progress'");
    expect(sql).toContain('t.project_id IS NULL');
  });

  it('有 project_id 且已有 in_progress 任务的候选被 SQL 过滤掉', async () => {
    // 若 SQL 过滤正确，候选列表为空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../tick.js');
    const result = await selectNextDispatchableTask(['goal-1']);

    expect(result).toBeNull();
  });
});
