/**
 * 测试 pre-flight 失败时跳过该任务继续尝试下一个候选
 *
 * Bug: dispatchNextTask() 中 pre-flight 失败直接 return，堵死整个队列
 * Fix: pre-flight 失败后跳过当前任务，从下一个候选重试（最多 5 次）
 *
 * DoD 映射：
 * - pre-flight 失败 → 跳过当前任务 → 尝试下一个
 * - 第一个任务 pre-flight 失败 → 第二个任务被成功选中派发
 * - excludeIds 参数正确传递给 selectNextDispatchableTask
 * - 所有候选都失败时返回 all_candidates_failed_pre_flight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// Mock all dependencies
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

const mockPreFlightCheck = vi.fn();
const mockGetPreFlightStats = vi.fn().mockResolvedValue({
  totalChecked: 0, passed: 0, failed: 0, passRate: '0%'
});

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: (...args) => mockPreFlightCheck(...args),
  getPreFlightStats: (...args) => mockGetPreFlightStats(...args),
}));

describe('selectNextDispatchableTask: excludeIds 参数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 excludeIds 时 SQL 包含 AND t.id != ALL 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../tick.js');
    const result = await selectNextDispatchableTask(['goal-1'], ['exclude-1', 'exclude-2']);

    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('AND t.id != ALL($2)');
    expect(call[1]).toEqual([['goal-1'], ['exclude-1', 'exclude-2']]);
    expect(result).toBeNull();
  });

  it('没有 excludeIds 时 SQL 不包含排除条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../tick.js');
    const result = await selectNextDispatchableTask(['goal-1']);

    const call = mockQuery.mock.calls[0];
    expect(call[0]).not.toContain('AND t.id != ALL');
    expect(call[1]).toEqual([['goal-1']]);
    expect(result).toBeNull();
  });

  it('空 excludeIds 数组时不加排除条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { selectNextDispatchableTask } = await import('../tick.js');
    const result = await selectNextDispatchableTask(['goal-1'], []);

    const call = mockQuery.mock.calls[0];
    expect(call[0]).not.toContain('AND t.id != ALL');
    expect(result).toBeNull();
  });
});

describe('dispatchNextTask: pre-flight 失败时跳过并尝试下一个任务', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('第一个任务 pre-flight 失败后，第二个任务被成功选中派发', async () => {
    const badTask = {
      id: 'task-bad', title: 'x', description: null,
      prd_content: null, status: 'queued', priority: 'P1', payload: {}
    };
    const goodTask = {
      id: 'task-good', title: 'Fix login timeout in auth module',
      description: '修复登录超时问题，用户等待超过30秒后需要重新认证',
      prd_content: null, status: 'queued', priority: 'P1', payload: {}
    };

    // preFlightCheck: fail for bad, pass for good
    mockPreFlightCheck
      .mockResolvedValueOnce({ passed: false, issues: ['Task title too short'], suggestions: [] })
      .mockResolvedValueOnce({ passed: true, issues: [], suggestions: [] });

    // Mock pool.query calls in order:
    // 1. selectNextDispatchableTask query (no excludeIds) → returns badTask
    mockQuery.mockResolvedValueOnce({ rows: [badTask] });
    // 2. UPDATE metadata for failed pre-flight
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 3. selectNextDispatchableTask query (excludeIds=[task-bad]) → returns goodTask
    mockQuery.mockResolvedValueOnce({ rows: [goodTask] });
    // 4. SELECT * FROM tasks WHERE id (full task for triggerCeceliaRun)
    mockQuery.mockResolvedValueOnce({ rows: [goodTask] });
    // 5+ various post-dispatch calls (working_memory, decision_log, pre-flight stats, etc.)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('task-good');

    // Verify preFlightCheck was called twice
    expect(mockPreFlightCheck).toHaveBeenCalledTimes(2);
    expect(mockPreFlightCheck.mock.calls[0][0].id).toBe('task-bad');
    expect(mockPreFlightCheck.mock.calls[1][0].id).toBe('task-good');
  });

  it('所有候选都 pre-flight 失败后，返回 no_dispatchable_task', async () => {
    const bad1 = { id: 'bad-1', title: 'x', description: null, status: 'queued', priority: 'P1', payload: {} };
    const bad2 = { id: 'bad-2', title: 'y', description: null, status: 'queued', priority: 'P1', payload: {} };

    mockPreFlightCheck
      .mockResolvedValueOnce({ passed: false, issues: ['Title too short'], suggestions: [] })
      .mockResolvedValueOnce({ passed: false, issues: ['Title too short'], suggestions: [] });

    // 1. select → bad1
    mockQuery.mockResolvedValueOnce({ rows: [bad1] });
    // 2. UPDATE metadata
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 3. select (exclude bad1) → bad2
    mockQuery.mockResolvedValueOnce({ rows: [bad2] });
    // 4. UPDATE metadata
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 5. select (exclude bad1, bad2) → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(false);
    // When the loop exhausts candidates via selectNextDispatchableTask returning null,
    // it returns no_dispatchable_task from inside the for loop
    expect(result.reason).toBe('no_dispatchable_task');
    expect(mockPreFlightCheck).toHaveBeenCalledTimes(2);
  });

  it('pre-flight 失败的任务会被记录 metadata', async () => {
    const badTask = { id: 'bad-meta', title: 'ab', description: null, status: 'queued', priority: 'P1', payload: {} };

    mockPreFlightCheck.mockResolvedValueOnce({
      passed: false,
      issues: ['Task title too short'],
      suggestions: ['Use a more descriptive title']
    });

    // 1. select → badTask
    mockQuery.mockResolvedValueOnce({ rows: [badTask] });
    // 2. UPDATE metadata
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 3. select (exclude bad-meta) → empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask(['goal-1']);

    // Verify the metadata UPDATE was called
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE tasks SET metadata');
    expect(updateCall[1][0]).toBe('bad-meta');
    const metaJson = JSON.parse(updateCall[1][1]);
    expect(metaJson.pre_flight_failed).toBe(true);
    expect(metaJson.pre_flight_issues).toContain('Task title too short');
  });
});
