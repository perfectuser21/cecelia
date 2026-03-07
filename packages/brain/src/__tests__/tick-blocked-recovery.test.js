/**
 * tick-blocked-recovery 单元测试
 * 验证 tick 执行时调用 unblockExpiredTasks 自动恢复过期的 blocked 任务
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 区（所有 tick.js 依赖）──────────────────────────

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined), ensureEventsTable: vi.fn(), queryEvents: vi.fn().mockResolvedValue({ rows: [] }), getEventCounts: vi.fn().mockResolvedValue([]) }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: false }),
  getActiveProcessCount: vi.fn().mockReturnValue(0), killProcess: vi.fn(), checkServerResources: vi.fn().mockResolvedValue({}),
  probeTaskLiveness: vi.fn(), syncOrphanTasksOnStartup: vi.fn(), killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(), MAX_SEATS: 4, INTERACTIVE_RESERVE: 2, getBillingPause: vi.fn().mockReturnValue(null),
}));
vi.mock('../slot-allocator.js', () => ({ calculateSlotBudget: vi.fn().mockReturnValue({ budget: 2 }) }));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({ overall_health: 'healthy', next_actions: [], goals: [] }),
  generateDecision: vi.fn(), executeDecision: vi.fn(), splitActionsBySafety: vi.fn().mockReturnValue({ safeActions: [], unsafeActions: [] }),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true), recordSuccess: vi.fn(), recordFailure: vi.fn(), getAllStates: vi.fn().mockReturnValue({}),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn(), publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(), publishTaskProgress: vi.fn(), publishCognitiveState: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(), expireStaleProposals: vi.fn().mockResolvedValue(0),
}));
vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(), evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, levelName: 'CALM' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  canDispatch: vi.fn().mockReturnValue(true), canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1), ALERTNESS_LEVELS: { ALERT: 3 }, LEVEL_NAMES: {},
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(), getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn(), getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn().mockResolvedValue({}) }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue([]) }));
vi.mock('../daily-review-scheduler.js', () => ({
  triggerDailyReview: vi.fn().mockResolvedValue(null), triggerContractScan: vi.fn().mockResolvedValue(null),
}));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue(null) }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue(null) }));
vi.mock('../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../cognitive-core.js', () => ({
  evaluateEmotion: vi.fn().mockResolvedValue({}), getCurrentEmotion: vi.fn().mockReturnValue({}),
  updateSubjectiveTime: vi.fn(), getSubjectiveTime: vi.fn().mockReturnValue({}),
  getParallelAwareness: vi.fn().mockReturnValue([]), getTrustScores: vi.fn().mockReturnValue({}),
  updateNarrative: vi.fn(), recordTickEvent: vi.fn(), getCognitiveSnapshot: vi.fn().mockReturnValue({}),
}));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: vi.fn().mockResolvedValue(null) }));
vi.mock('../consolidation.js', () => ({ runDailyConsolidationIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../task-weight.js', () => ({ sortTasksByWeight: vi.fn(tasks => tasks) }));
vi.mock('../alerting.js', () => ({ flushAlertsIfNeeded: vi.fn().mockResolvedValue(null), raise: vi.fn() }));
vi.mock('../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue(null), synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue(null),
}));
vi.mock('../task-generator-scheduler.js', () => ({
  triggerCodeQualityScan: vi.fn().mockResolvedValue(null), getScannerStatus: vi.fn().mockReturnValue({}),
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));
vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../shepherd.js', () => ({ shepherdOpenPRs: vi.fn().mockResolvedValue({ processed: 0, merged: 0, failed: 0, pending: 0 }) }));

// task-updater mock — 重点测试 unblockExpiredTasks 是否被调用
const mockUnblockExpiredTasks = vi.fn().mockResolvedValue([]);
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
  unblockTask: vi.fn(),
  unblockExpiredTasks: mockUnblockExpiredTasks,
}));

// ── 导入被测函数 ──────────────────────────────────────────

const { executeTick } = await import('../tick.js');

// ── 测试 ─────────────────────────────────────────────────

describe('tick — blocked 任务自动恢复', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('每次 executeTick 应调用 unblockExpiredTasks', async () => {
    await executeTick();

    expect(mockUnblockExpiredTasks).toHaveBeenCalledOnce();
  });

  it('有恢复的任务时应写入 actionsTaken', async () => {
    mockUnblockExpiredTasks.mockResolvedValueOnce([
      { task_id: 'task-001', title: '任务A', blocked_reason: 'billing_cap' },
    ]);

    const result = await executeTick();

    const unblockAction = result.actions_taken?.find(a => a.action === 'auto_unblock');
    expect(unblockAction).toBeDefined();
    expect(unblockAction.task_id).toBe('task-001');
    expect(unblockAction.blocked_reason).toBe('billing_cap');
  });

  it('unblockExpiredTasks 抛出异常时 tick 不中断', async () => {
    mockUnblockExpiredTasks.mockRejectedValueOnce(new Error('DB connection lost'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await executeTick();

    // tick 应正常完成（返回 success 或至少不抛出）
    expect(result).toBeDefined();
    errorSpy.mockRestore();
  });
});
