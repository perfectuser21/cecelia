/**
 * tick autoUnblockBlockedTasks 单元测试
 * 测试自动解除阻塞逻辑（dependency 类型）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 区 ──────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

// mock task-updater unblockTask
const mockUnblockTask = vi.fn();
vi.mock('../task-updater.js', () => ({
  unblockTask: mockUnblockTask,
  blockTask: vi.fn(),
  blockTaskWithDetail: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
  broadcastTaskState: vi.fn(),
}));

// mock 所有 tick 的重依赖（只需 autoUnblockBlockedTasks）
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn() }));
vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
  getActiveProcessCount: vi.fn(() => 0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn(() => ({ ok: true, metrics: {} })),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 4,
  INTERACTIVE_RESERVE: 1,
  getBillingPause: vi.fn(() => null),
  removeActiveProcess: vi.fn(),
}));
vi.mock('../slot-allocator.js', () => ({ calculateSlotBudget: vi.fn(() => ({ taskPool: { available: 2, budget: 2 }, user: { mode: 'absent', used: 0 } })) }));
vi.mock('../decision.js', () => ({ compareGoalProgress: vi.fn(), generateDecision: vi.fn(), executeDecision: vi.fn(), splitActionsBySafety: vi.fn(() => ({ safe: [], unsafe: [] })) }));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn(), getPlanStatus: vi.fn(), handlePlanInput: vi.fn(), getGlobalState: vi.fn(), selectTopAreas: vi.fn(), selectActiveInitiativeForArea: vi.fn(), ACTIVE_AREA_COUNT: 3 }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(), ensureEventsTable: vi.fn(), queryEvents: vi.fn(), getEventCounts: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ isAllowed: vi.fn(() => true), recordSuccess: vi.fn(), recordFailure: vi.fn(), getAllStates: vi.fn(() => ({})), getState: vi.fn(), reset: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), publishTaskProgress: vi.fn(), publishExecutorStatus: vi.fn(), publishCognitiveState: vi.fn() }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn(), expireStaleProposals: vi.fn() }));
vi.mock('../alertness/index.js', () => ({ initAlertness: vi.fn(), evaluateAlertness: vi.fn(() => ({ level: 1, score: 0 })), getCurrentAlertness: vi.fn(() => ({ level: 1 })), canDispatch: vi.fn(() => true), canPlan: vi.fn(() => true), getDispatchRate: vi.fn(() => 1.0), ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 }, LEVEL_NAMES: { 0: 'SLEEPING', 1: 'CALM', 2: 'AWARE', 3: 'ALERT', 4: 'PANIC' }, setManualOverride: vi.fn(), clearManualOverride: vi.fn() }));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../quarantine.js', () => ({ handleTaskFailure: vi.fn(), getQuarantineStats: vi.fn(() => ({})), checkExpiredQuarantineTasks: vi.fn(() => []), getQuarantinedTasks: vi.fn(() => []), releaseTask: vi.fn(), quarantineTask: vi.fn(), QUARANTINE_REASONS: {}, REVIEW_ACTIONS: {}, classifyFailure: vi.fn() }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn(), getDispatchStats: vi.fn(() => ({})) }));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn() }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn() }));
vi.mock('../daily-review-scheduler.js', () => ({ triggerDailyReview: vi.fn(), triggerContractScan: vi.fn() }));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn() }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn() }));
vi.mock('../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn() }));
vi.mock('../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn() }));
vi.mock('../cognitive-core.js', () => ({ evaluateEmotion: vi.fn(() => ({ state: 'neutral', dispatch_rate_modifier: 1.0 })), getCurrentEmotion: vi.fn(() => ({ state: 'neutral', dispatch_rate_modifier: 1.0 })), updateSubjectiveTime: vi.fn(), getSubjectiveTime: vi.fn(() => ({})), getParallelAwareness: vi.fn(() => ({})), getTrustScores: vi.fn(() => ({})), updateNarrative: vi.fn(), recordTickEvent: vi.fn(), getCognitiveSnapshot: vi.fn(() => ({})) }));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: vi.fn() }));
vi.mock('../consolidation.js', () => ({ runDailyConsolidationIfNeeded: vi.fn() }));
vi.mock('../task-weight.js', () => ({ sortTasksByWeight: vi.fn(tasks => tasks) }));
vi.mock('../alerting.js', () => ({ flushAlertsIfNeeded: vi.fn() }));
vi.mock('../evolution-scanner.js', () => ({ scanEvolutionIfNeeded: vi.fn(), synthesizeEvolutionIfNeeded: vi.fn() }));
vi.mock('../task-generator-scheduler.js', () => ({ triggerCodeQualityScan: vi.fn(), getScannerStatus: vi.fn() }));

// ── 导入被测模块 ──────────────────────────────────────────

const { autoUnblockBlockedTasks } = await import('../tick.js');

// ── 辅助函数 ────────────────────────────────────────────

function makeBlockedTask(overrides = {}) {
  return {
    id: 'blocked-task-001',
    title: '等待依赖任务',
    blocked_detail: {
      type: 'dependency',
      blocker_id: 'dep-task-001',
      reason: '依赖任务尚未完成',
      blocked_at: new Date().toISOString(),
      auto_resolve: true,
    },
    ...overrides,
  };
}

// ── 测试 ─────────────────────────────────────────────────

describe('autoUnblockBlockedTasks', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockUnblockTask.mockReset();
  });

  it('应当在没有 blocked 任务时返回空数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    expect(mockUnblockTask).not.toHaveBeenCalled();
  });

  it('应当在依赖任务完成时自动解除阻塞', async () => {
    const blockedTask = makeBlockedTask();

    // Query 1: 查询 blocked 任务
    mockPool.query.mockResolvedValueOnce({ rows: [blockedTask] });
    // Query 2: 查询 blocker 状态 → completed
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });

    mockUnblockTask.mockResolvedValueOnce({ success: true, task: { id: 'blocked-task-001', status: 'queued' } });

    const result = await autoUnblockBlockedTasks();

    expect(result).toContain('blocked-task-001');
    expect(mockUnblockTask).toHaveBeenCalledWith('blocked-task-001');
  });

  it('应当在依赖任务不存在时解除阻塞（blocker 已删除）', async () => {
    const blockedTask = makeBlockedTask();

    mockPool.query.mockResolvedValueOnce({ rows: [blockedTask] });
    // blocker 不存在
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    mockUnblockTask.mockResolvedValueOnce({ success: true, task: { id: 'blocked-task-001', status: 'queued' } });

    const result = await autoUnblockBlockedTasks();

    expect(result).toContain('blocked-task-001');
    expect(mockUnblockTask).toHaveBeenCalledWith('blocked-task-001');
  });

  it('应当在依赖任务未完成时不解除阻塞', async () => {
    const blockedTask = makeBlockedTask();

    mockPool.query.mockResolvedValueOnce({ rows: [blockedTask] });
    // blocker 仍在 in_progress
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] });

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    expect(mockUnblockTask).not.toHaveBeenCalled();
  });

  it('应当跳过 auto_resolve=false 的 blocked 任务（SQL 过滤）', async () => {
    // SQL 中已过滤 auto_resolve=true，此处模拟查询结果为空
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    // 验证 SQL 包含 auto_resolve 过滤
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('auto_resolve');
  });

  it('应当处理 unblockTask 失败的情况（不抛出）', async () => {
    const blockedTask = makeBlockedTask();

    mockPool.query.mockResolvedValueOnce({ rows: [blockedTask] });
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });
    // unblockTask 失败
    mockUnblockTask.mockResolvedValueOnce({ success: false, error: '状态不匹配' });

    const result = await autoUnblockBlockedTasks();

    // 失败时不加入结果
    expect(result).toEqual([]);
  });

  it('应当处理多个 blocked 任务', async () => {
    const task1 = makeBlockedTask({ id: 'task-a', title: '任务A' });
    const task2 = makeBlockedTask({ id: 'task-b', title: '任务B', blocked_reason: { ...makeBlockedTask().blocked_reason, blocker_id: 'dep-002' } });

    mockPool.query.mockResolvedValueOnce({ rows: [task1, task2] });
    // task1 的 blocker: completed
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'completed' }] });
    // task2 的 blocker: in_progress
    mockPool.query.mockResolvedValueOnce({ rows: [{ status: 'in_progress' }] });

    mockUnblockTask.mockResolvedValueOnce({ success: true, task: { id: 'task-a', status: 'queued' } });

    const result = await autoUnblockBlockedTasks();

    expect(result).toContain('task-a');
    expect(result).not.toContain('task-b');
    expect(mockUnblockTask).toHaveBeenCalledTimes(1);
    expect(mockUnblockTask).toHaveBeenCalledWith('task-a');
  });

  it('应当在 DB 查询异常时静默处理并返回空数组', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[tick] autoUnblockBlockedTasks error:'),
      'connection refused'
    );
    errorSpy.mockRestore();
  });

  it('应当忽略 blocked_reason 为 null 的任务', async () => {
    const taskWithNullReason = { id: 'task-null', title: '无原因阻塞', blocked_reason: null };
    mockPool.query.mockResolvedValueOnce({ rows: [taskWithNullReason] });

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    expect(mockUnblockTask).not.toHaveBeenCalled();
  });

  it('应当忽略非 dependency 类型的 blocked 任务', async () => {
    const prReviewTask = makeBlockedTask({
      id: 'task-pr',
      blocked_detail: {
        type: 'pr_review',
        blocker_id: null,
        reason: '等待 Code Review',
        blocked_at: new Date().toISOString(),
        auto_resolve: true,
      }
    });

    mockPool.query.mockResolvedValueOnce({ rows: [prReviewTask] });

    const result = await autoUnblockBlockedTasks();

    expect(result).toEqual([]);
    // 对于 pr_review 类型，不查询 blocker 状态（没有第二次 DB 查询）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});
