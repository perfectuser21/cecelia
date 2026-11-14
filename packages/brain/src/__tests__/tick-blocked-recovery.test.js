/**
 * tick-blocked-recovery 单元测试
 * 验证 tick 执行时调用 unblockExpiredTasks 自动恢复过期的 blocked 任务
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const cleanupStubs = vi.hoisted(() => ({
  zombie: vi.fn().mockName('runZombieCleanup').mockResolvedValue({ slotsReclaimed: 0, worktreesRemoved: 0 }),
  worker: vi.fn().mockName('runCleanupWorker').mockResolvedValue({ success: true, stdout: '' }),
}));

// ── mock 区（所有 tick.js 依赖）──────────────────────────

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined), ensureEventsTable: vi.fn(), queryEvents: vi.fn().mockResolvedValue({ rows: [] }), getEventCounts: vi.fn().mockResolvedValue([]) }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: false }),
  getActiveProcessCount: vi.fn().mockReturnValue(0), killProcess: vi.fn(), checkServerResources: vi.fn().mockResolvedValue({}),
  probeTaskLiveness: vi.fn(), syncOrphanTasksOnStartup: vi.fn(), killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(), MAX_SEATS: 4, INTERACTIVE_RESERVE: 2, getBillingPause: vi.fn().mockReturnValue(null),
  getActiveProcesses: vi.fn().mockReturnValue([]),
}));
vi.mock('../slot-allocator.js', () => ({ harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }), calculateSlotBudget: vi.fn().mockReturnValue({ budget: 2 }) }));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({ overall_health: 'healthy', next_actions: [], goals: [] }),
  generateDecision: vi.fn(), executeDecision: vi.fn(), splitActionsBySafety: vi.fn().mockReturnValue({ safeActions: [], unsafeActions: [] }),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null), checkPrPlansCompletion: vi.fn().mockResolvedValue([]) }));
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
vi.mock('../zombie-sweep.js', () => ({ zombieSweep: vi.fn().mockResolvedValue({}), getZombieSweepStatus: vi.fn().mockResolvedValue(null) }));
// 本文件只验 blocked 恢复；这些动态依赖会清理宿主资源，必须独立 stub。
vi.mock('../zombie-cleaner.js', () => ({
  runZombieCleanup: cleanupStubs.zombie,
}));
vi.mock('../cleanup-worker.js', () => ({
  runCleanupWorker: cleanupStubs.worker,
}));
vi.mock('../progress-ledger.js', () => ({ evaluateProgressInTick: vi.fn().mockResolvedValue({ evaluated: 0, alertCount: 0 }), recordProgressStep: vi.fn(), getProgressSteps: vi.fn().mockResolvedValue([]), updateProgressStep: vi.fn(), getTaskProgressSummary: vi.fn().mockResolvedValue(null), getProgressAnomalies: vi.fn().mockResolvedValue([]) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn().mockResolvedValue(''), callLLMStream: vi.fn().mockResolvedValue(''), _resetMinimaxKey: vi.fn(), _resetAnthropicKey: vi.fn(), _resetOpenAIKey: vi.fn() }));

// task-updater mock — 重点测试 unblockExpiredTasks 是否被调用
const mockUnblockExpiredTasks = vi.fn().mockResolvedValue([]);
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
  unblockTask: vi.fn(),
  unblockExpiredTasks: mockUnblockExpiredTasks,
}));

// ── 导入被测函数 ──────────────────────────────────────────
// isolate:true 模式下每个文件已有独立模块注册表，无需 vi.resetModules()
let executeTick, tickState, resourceCleaners;

beforeAll(async () => {
  const [zombie, cleanup] = await Promise.all([
    import('../zombie-cleaner.js'), import('../cleanup-worker.js'),
  ]);
  resourceCleaners = [zombie.runZombieCleanup, cleanup.runCleanupWorker];
  // 在导入/执行 tick 之前失败，漏 mock 时不能先清理宿主再报断言错误。
  expect(resourceCleaners).toEqual([cleanupStubs.zombie, cleanupStubs.worker]);
  ({ tickState } = await import('../tick-state.js'));
  const mod = await import('../tick.js');
  executeTick = mod.executeTick;
});

// ── 测试 ─────────────────────────────────────────────────

describe('tick — blocked 任务自动恢复', () => {
  it('资源清理边界必须隔离，blocked recovery 不得调用真实工作树清理', async () => {
    await executeTick();
    for (const cleaner of resourceCleaners) expect(cleaner).toHaveBeenCalledOnce();
    expect(mockUnblockExpiredTasks).toHaveBeenCalledOnce();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // 阻止无关周期插件在本用例触发；只主动覆盖已隔离的清理接缝。
    for (const key of Object.keys(tickState)) {
      if (key.startsWith('last') && typeof tickState[key] === 'number') tickState[key] = Date.now();
    }
    tickState.lastZombieCleanupTime = 0;
    tickState.lastCleanupWorkerTime = 0;
  });

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
