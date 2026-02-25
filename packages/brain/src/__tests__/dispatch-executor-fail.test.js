/**
 * 测试 Bug #1: triggerCeceliaRun 失败时不应返回 dispatched=true
 * 测试 Bug #5: processCortexTask 失败时应调用 handleTaskFailure 进行 quarantine 检查
 *
 * DoD 映射：
 * - triggerCeceliaRun success=false → revert to queued, return dispatched=false
 * - triggerCeceliaRun success=false → recordFailure('cecelia-run') 被调用
 * - processCortexTask catch → handleTaskFailure 被调用
 * - processCortexTask 反复失败 → quarantine
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
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
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

const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' })
}));

const mockHandleTaskFailure = vi.fn();
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: (...args) => mockHandleTaskFailure(...args),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([])
}));

describe('Bug #1: triggerCeceliaRun 失败时 revert 任务并返回 dispatched=false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executor success=false → dispatched=false, task reverted to queued', async () => {
    const task = {
      id: 'task-exec-fail', title: 'Good task title here',
      description: '有完整描述的合法任务，应该通过 pre-flight',
      status: 'queued', priority: 'P1', payload: {}
    };

    // triggerCeceliaRun 返回 success=false
    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: false,
      taskId: task.id,
      reason: 'bridge_error',
      error: 'Bridge connection refused'
    });

    // Mock pool.query calls:
    // 1. selectNextDispatchableTask → returns task
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    // 2. SELECT * FROM tasks (full task for triggerCeceliaRun)
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    // 3+ post-failure DB calls (logTickDecision, etc.)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    // 核心断言：dispatched 必须是 false
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('executor_failed');
    expect(result.task_id).toBe('task-exec-fail');

    // 任务被 revert 回 queued
    expect(mockUpdateTask).toHaveBeenCalledWith({
      task_id: 'task-exec-fail',
      status: 'queued'
    });

    // circuit-breaker recordFailure 被调用
    expect(mockRecordFailure).toHaveBeenCalledWith('cecelia-run');

    // dispatch stats 记录失败
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(
      expect.anything(), false, 'executor_failed'
    );
  });

  it('executor success=true → dispatched=true (正常路径不受影响)', async () => {
    const task = {
      id: 'task-exec-ok', title: 'Normal working task',
      description: '正常任务应该成功派发',
      status: 'queued', priority: 'P1', payload: {}
    };

    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: true,
      runId: 'run-ok-123',
      taskId: task.id
    });

    // 1. selectNextDispatchableTask
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    // 2. SELECT * FROM tasks
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    // 3+ post-success DB calls
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('task-exec-ok');

    // revert 不应该被调用（updateTask 只在 in_progress 时调用）
    const revertCalls = mockUpdateTask.mock.calls.filter(
      c => c[0].status === 'queued'
    );
    expect(revertCalls).toHaveLength(0);

    // recordFailure 不应该被调用
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });
});

describe('Bug #5: processCortexTask 失败时调用 handleTaskFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cortex 任务异常时调用 handleTaskFailure 而非直接 UPDATE failed', async () => {
    // 模拟 handleTaskFailure 返回未隔离（失败次数不够）
    mockHandleTaskFailure.mockResolvedValueOnce({
      quarantined: false,
      failure_count: 1
    });

    const cortexTask = {
      id: 'cortex-fail-1',
      title: 'RCA Analysis Task',
      description: 'Deep analysis',
      status: 'queued',
      priority: 'P1',
      payload: { requires_cortex: true, trigger: 'test', signals: {} }
    };

    // Mock cortex.js to throw
    vi.doMock('../cortex.js', () => ({
      performRCA: vi.fn().mockRejectedValue(new Error('Cortex LLM timeout'))
    }));

    // 1. UPDATE payload (rca_error)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 2+ other DB calls
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { processCortexTask } = await import('../tick.js');
    const result = await processCortexTask(cortexTask, []);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('cortex_error');

    // 核心断言：handleTaskFailure 被调用
    expect(mockHandleTaskFailure).toHaveBeenCalledWith('cortex-fail-1');

    // updateTask 被调用设置 failed（因为未达到 quarantine 阈值）
    expect(mockUpdateTask).toHaveBeenCalledWith({
      task_id: 'cortex-fail-1',
      status: 'failed'
    });
  });

  it('cortex 任务反复失败达到阈值时被 quarantine', async () => {
    // 模拟 handleTaskFailure 返回已隔离
    mockHandleTaskFailure.mockResolvedValueOnce({
      quarantined: true,
      result: { reason: 'repeated_failure' },
      failure_count: 3
    });

    const cortexTask = {
      id: 'cortex-quarantine-1',
      title: 'Failing RCA Task',
      description: 'Repeatedly failing',
      status: 'queued',
      priority: 'P1',
      payload: { requires_cortex: true, trigger: 'test', signals: {} }
    };

    vi.doMock('../cortex.js', () => ({
      performRCA: vi.fn().mockRejectedValue(new Error('Cortex API unavailable'))
    }));

    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { processCortexTask } = await import('../tick.js');
    const result = await processCortexTask(cortexTask, []);

    expect(result.dispatched).toBe(false);
    expect(mockHandleTaskFailure).toHaveBeenCalledWith('cortex-quarantine-1');

    // quarantine 时不应该再调用 updateTask(status='failed')
    const failedCalls = mockUpdateTask.mock.calls.filter(
      c => c[0].status === 'failed'
    );
    expect(failedCalls).toHaveLength(0);
  });
});
