// 主线A（收权）：in_progress 任务数不再是判定依据；判定走 harnessSlotCheck
//
// 终审 Fix 2（beeba317）：deny/兜底路径此前零行为测试。本文件的 mock 集合
// 需要覆盖 dispatchNextTask 完整依赖图（复用 dispatcher-circuit-harness-exempt.test.js
// 的手法），因为 vi.mock 按文件 hoist，同文件内所有 describe 共用同一份 mock。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));

vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));

const mockTriggerCeceliaRun = vi.fn().mockResolvedValue({ success: true, pid: 12345 });
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));

const mockHarnessSlotCheck = vi.fn();
vi.mock('../slot-allocator.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    harnessSlotCheck: (...args) => mockHarnessSlotCheck(...args),
    calculateSlotBudget: vi.fn().mockResolvedValue({
      dispatchAllowed: true,
      taskPool: { budget: 5, available: 3 },
      user: { mode: 'absent', used: 0 },
      codex: { available: true, running: 0, max: 5 },
    }),
  };
});

vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const mockIsAllowed = vi.fn(() => true);
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
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
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

const mockSelectNextDispatchableTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({}),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

import { shouldApplyHarnessCap, HARNESS_TASK_CAP_BACKSTOP, dispatchNextTask } from '../dispatcher.js';

describe('harness cap 收权后语义（beeba317）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsAllowed.mockReturnValue(true);
  });

  it('MAX_CONCURRENT_HARNESS_INITIATIVES 已删除', async () => {
    const mod = await import('../dispatcher.js');
    expect(mod.MAX_CONCURRENT_HARNESS_INITIATIVES).toBeUndefined();
    expect(mod.harnessConcurrencyExceeded).toBeUndefined();
  });

  it('TASK_CAP 兜底常量 = 12', () => {
    expect(HARNESS_TASK_CAP_BACKSTOP).toBe(12);
  });

  it('shouldApplyHarnessCap 语义不变：harness_initiative 受控', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'golden_path_proposal' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'dev' })).toBe(false);
  });

  it('resume 豁免语义不变（回归：OPEN-2 自愈锁死案）', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: { resume_from_checkpoint: true } })).toBe(false);
  });
});

// ============================================================
// deny / 兜底路径行为测试（终审 Fix 2）：驱动完整 dispatchNextTask，
// 让候选真的走到 3b'' 块，断言 dispatch 结果的 reason。
// ============================================================
describe('harness admission 3b\'\' 块 — deny/兜底路径行为（beeba317 终审 Fix 2）', () => {
  function makeQueryMock({ taskId, runningCount }) {
    return (sql) => {
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: taskId }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        return Promise.resolve({ rows: [{ id: taskId, task_type: 'harness_initiative', title: 'harness sprint' }] });
      }
      if (/count\(\*\)/i.test(sql) && /harness_initiative/.test(sql)) {
        return Promise.resolve({ rows: [{ n: runningCount }] });
      }
      return Promise.resolve({ rows: [] });
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsAllowed.mockReturnValue(true);
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 12345 });
    mockHarnessSlotCheck.mockReset();
    mockSelectNextDispatchableTask.mockReset();
  });

  it('task_cap_backstop：in_progress 计数达 12 → 直接兜底拒发，不调 harnessSlotCheck', async () => {
    mockQuery.mockImplementation(makeQueryMock({ taskId: 'task-cap-1', runningCount: 12 }));
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-cap-1',
      task_type: 'harness_initiative',
      project_id: 'proj-cap-1',
      title: 'harness sprint cap test',
    });

    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('task_cap_backstop');
    expect(result.running).toBe(12);
    expect(mockHarnessSlotCheck).not.toHaveBeenCalled();
  });

  it('deny 路径：任务数未达兜底但 harnessSlotCheck 拒绝 → reason=cap_reached', async () => {
    mockQuery.mockImplementation(makeQueryMock({ taskId: 'task-cap-2', runningCount: 4 }));
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-cap-2',
      task_type: 'harness_initiative',
      project_id: 'proj-cap-2',
      title: 'harness sprint deny test',
    });
    mockHarnessSlotCheck.mockResolvedValue({
      allow: false,
      reason: 'cap_reached',
      containers: 4,
      inflight: 0,
      cap: { effective: 4, mem_cap: 4, acct_cap: 4, hard_cap: 4 },
      stale: false,
    });

    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('cap_reached');
    expect(mockHarnessSlotCheck).toHaveBeenCalledTimes(1);
    expect(result.slot_check).toMatchObject({ allow: false, reason: 'cap_reached', containers: 4, stale: false });
  });
});
