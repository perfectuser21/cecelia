/**
 * 测试 Initiative 级锁：同一 Initiative（project_id）已有 in_progress 任务时，不再派发新任务
 *
 * DoD 映射：
 * - DoD-1: selectNextDispatchableTask SQL 包含 NOT EXISTS 子查询（Initiative 锁）
 * - DoD-2: dispatchNextTask 在 pre-flight 后做二次 initiative 锁检查
 * - DoD-3: 跳过时 reason = 'initiative_locked'
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
  })
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

describe('dispatchNextTask: Initiative 二次锁检查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('候选任务有 project_id 且二次检查发现 in_progress 任务时返回 initiative_locked', async () => {
    // 注：initiative lock 仅对 harness pipeline 类型生效（dev/talk/audit 不锁）
    const candidateTask = {
      id: 'task-candidate',
      title: '实现新功能',
      description: '功能描述',
      prd_content: null,
      status: 'queued',
      priority: 'P1',
      payload: {},
      project_id: 'proj-initiative-1',
      task_type: 'harness_task',
      metadata: {}
    };

    // pool.query 调用顺序：
    // 1. selectNextDispatchableTask 主查询 → 返回候选
    mockQuery.mockResolvedValueOnce({ rows: [candidateTask] });
    // 2. Initiative 二次锁检查 → 发现已有 in_progress 任务
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'task-blocking', title: '另一个进行中任务' }]
    });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('initiative_locked');
    expect(result.blocking_task_id).toBe('task-blocking');
    expect(result.task_id).toBe('task-candidate');
  });

  it('候选任务 project_id 为 null 时跳过 Initiative 锁检查，正常派发', async () => {
    const candidateTask = {
      id: 'task-no-project',
      title: '独立任务（无 Initiative）',
      description: '描述',
      prd_content: null,
      status: 'queued',
      priority: 'P1',
      payload: {},
      project_id: null,
      metadata: {}
    };

    // pool.query 调用顺序：
    // 1. 主查询 → 候选（无 initiative 锁检查，project_id 为 null）
    mockQuery.mockResolvedValueOnce({ rows: [candidateTask] });
    // 2. C1 claim: UPDATE tasks SET claimed_by ... RETURNING id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: candidateTask.id }] });
    // 3. SELECT * FROM tasks（fullTaskResult，dispatch 继续执行时）
    mockQuery.mockResolvedValueOnce({ rows: [candidateTask] });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    // 关键：没有 initiative_locked，锁检查被跳过
    expect(result.reason).not.toBe('initiative_locked');
    const lockCheckCalls = mockQuery.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('project_id = $1') && c[0].includes("status = 'in_progress'")
    );
    expect(lockCheckCalls).toHaveLength(0);
  });

  it('Initiative 无 in_progress 任务时正常派发（锁检查通过）', async () => {
    // 注：initiative lock 仅对 harness pipeline 类型生效
    const candidateTask = {
      id: 'task-candidate-2',
      title: '实现新功能 v2',
      description: '功能描述',
      prd_content: null,
      status: 'queued',
      priority: 'P1',
      payload: {},
      project_id: 'proj-initiative-2',
      task_type: 'harness_task',
      metadata: {}
    };

    // pool.query 调用顺序：
    // 1. 主查询 → 候选
    mockQuery.mockResolvedValueOnce({ rows: [candidateTask] });
    // 2. Initiative 锁检查 → 无 in_progress 任务（锁通过）
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 3. C1 claim: UPDATE tasks SET claimed_by ... RETURNING id
    mockQuery.mockResolvedValueOnce({ rows: [{ id: candidateTask.id }] });
    // 4. SELECT * FROM tasks（fullTaskResult，dispatch 继续执行时）
    mockQuery.mockResolvedValueOnce({ rows: [candidateTask] });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    // Initiative 锁检查应被执行，且通过
    const lockCheckCalls = mockQuery.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes("status = 'in_progress'") && c[0].includes('project_id = $1')
    );
    expect(lockCheckCalls).toHaveLength(1);
    expect(result.reason).not.toBe('initiative_locked');
  });
});
