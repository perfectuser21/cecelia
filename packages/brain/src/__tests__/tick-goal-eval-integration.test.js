/**
 * Tick ↔ Goal Evaluator 集成测试
 *
 * 验证 tick.js 中的 0.5.5 Goal Outer Loop 段落
 * 正确触发 evaluateGoalOuterLoop
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

const mockEvaluateGoalOuterLoop = vi.fn();
vi.mock('../goal-evaluator.js', () => ({
  evaluateGoalOuterLoop: (...args) => mockEvaluateGoalOuterLoop(...args),
  _resetGoalEvalTimes: vi.fn(),
}));

// 其他依赖 mock
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));
vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(), evaluateAlertness: vi.fn().mockResolvedValue({ score: 0, reasons: [], level: 'GREEN' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 'GREEN', score: 0 }),
  canDispatch: vi.fn().mockReturnValue(true), canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1), ALERTNESS_LEVELS: { GREEN: 'GREEN' }, LEVEL_NAMES: {}
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue({ reason: 'no_tasks' }) }));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue([]),
  generateDecision: vi.fn().mockResolvedValue(null),
  executeDecision: vi.fn(), splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], risky: [] })
}));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockReturnValue(0), killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn().mockResolvedValue([]),
  checkServerResources: vi.fn().mockResolvedValue({ ok: true }),
  probeTaskLiveness: vi.fn().mockResolvedValue(null),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue(0),
  killProcessTwoStage: vi.fn(), requeueTask: vi.fn(),
  MAX_SEATS: 4, INTERACTIVE_RESERVE: 1, getBillingPause: vi.fn().mockResolvedValue(false)
}));
vi.mock('../slot-allocator.js', () => ({ calculateSlotBudget: vi.fn().mockReturnValue({ available: 4 }) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true), recordSuccess: vi.fn(), recordFailure: vi.fn(), getAllStates: vi.fn().mockReturnValue({})
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn(), publishCognitiveState: vi.fn()
}));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn().mockResolvedValue(null), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(), expireStaleProposals: vi.fn().mockResolvedValue(0)
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(), getQuarantineStats: vi.fn().mockResolvedValue({}),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([])
}));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn(), getDispatchStats: vi.fn().mockResolvedValue({}) }));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn().mockResolvedValue({ summary: 'ok' }) }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue({}) }));
vi.mock('../daily-review-scheduler.js', () => ({ triggerDailyReview: vi.fn().mockResolvedValue({}) }));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue({}) }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({}) }));
vi.mock('../suggestion-triage.js', () => ({
  executeTriage: vi.fn().mockResolvedValue([]),
  cleanupExpiredSuggestions: vi.fn().mockResolvedValue(0),
  getTopPrioritySuggestions: vi.fn().mockResolvedValue([])
}));
vi.mock('../progress-ledger.js', () => ({ evaluateProgressInTick: vi.fn().mockResolvedValue([]) }));
vi.mock('../initiative-closer.js', () => ({
  checkInitiativeCompletion: vi.fn().mockResolvedValue({ closedCount: 0 }),
  checkProjectCompletion: vi.fn().mockResolvedValue({ closedCount: 0 }),
  activateNextInitiatives: vi.fn().mockResolvedValue({ activatedCount: 0 }),
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('tick.js: Goal Outer Loop (0.5.5)', () => {
  let executeTick;
  let _resetLastGoalEvalTime;
  let _resetLastCleanupTime;
  let GOAL_EVAL_INTERVAL_MS;

  beforeAll(async () => {
    const tickMod = await import('../tick.js');
    executeTick = tickMod.executeTick;
    _resetLastGoalEvalTime = tickMod._resetLastGoalEvalTime;
    _resetLastCleanupTime = tickMod._resetLastCleanupTime;
    GOAL_EVAL_INTERVAL_MS = tickMod.GOAL_EVAL_INTERVAL_MS;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    _resetLastGoalEvalTime?.();
    _resetLastCleanupTime?.();

    // 默认 DB mocks
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('calls evaluateGoalOuterLoop when interval elapsed', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([
      { goal_id: 'g1', verdict: 'on_track', action_taken: 'none' }
    ]);

    await executeTick();

    expect(mockEvaluateGoalOuterLoop).toHaveBeenCalled();
  });

  it('does not call evaluateGoalOuterLoop when interval not elapsed', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([]);

    // 第一次 tick 设置计时器
    await executeTick();
    mockEvaluateGoalOuterLoop.mockClear();

    // 第二次 tick — 未到 GOAL_EVAL_INTERVAL_MS
    await executeTick();

    expect(mockEvaluateGoalOuterLoop).not.toHaveBeenCalled();
  });

  it('includes goal_outer_loop action when stalled goals found', async () => {
    mockEvaluateGoalOuterLoop.mockResolvedValue([
      { goal_id: 'g1', verdict: 'stalled', action_taken: 'initiative_plan_created' }
    ]);

    const result = await executeTick();

    const goalAction = result.actions_taken?.find(a => a.action === 'goal_outer_loop');
    expect(goalAction).toBeDefined();
    expect(goalAction.stalled).toBe(1);
  });

  it('handles evaluateGoalOuterLoop failure gracefully', async () => {
    mockEvaluateGoalOuterLoop.mockRejectedValue(new Error('Goal eval failed'));

    // 不应该抛出
    await expect(executeTick()).resolves.not.toThrow();
  });

  it('GOAL_EVAL_INTERVAL_MS defaults to 24 hours', () => {
    expect(GOAL_EVAL_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
