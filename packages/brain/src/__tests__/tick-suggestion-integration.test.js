/**
 * tick.js × suggestion-triage 集成测试（架构迁移后）
 *
 * v2（信号源直接接 L1）：suggestion triage/dispatch 已从 tick.js 移除。
 * 本文件验证：
 *   - tick.js 不再调用 executeTriage / cleanupExpiredSuggestions
 *   - tick 仍能正常完成（返回 success: true）
 */

import { vi, describe, test, expect, beforeAll, beforeEach } from 'vitest';

// ── Mock ──────────────────────────────────────────────────────────────────────

vi.mock('../suggestion-triage.js', () => ({
  executeTriage: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTopPrioritySuggestions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));

vi.mock('../alertness/index.js', () => ({
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, score: 0, reasons: [], level_name: 'GREEN' }),
  initAlertness: vi.fn(),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 'GREEN', score: 0 }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { GREEN: 'GREEN' },
  LEVEL_NAMES: {},
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ level: 0, actions: [], rationale: 'ok', confidence: 0.9, safety: false }),
  EVENT_TYPES: {},
}));
vi.mock('../executor.js', () => ({
  cleanupOrphanProcesses: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue(0),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  checkServerResources: vi.fn().mockResolvedValue({ ok: true }),
  probeTaskLiveness: vi.fn().mockResolvedValue(null),
  killProcess: vi.fn(), killProcessTwoStage: vi.fn(), requeueTask: vi.fn(),
  triggerCeceliaRun: vi.fn(),
  MAX_SEATS: 4, INTERACTIVE_RESERVE: 1,
  getBillingPause: vi.fn().mockResolvedValue(false),
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
  expireStaleProposals: vi.fn().mockResolvedValue(0),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue({ reason: 'no_tasks' }) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true), recordSuccess: vi.fn(), recordFailure: vi.fn(), getAllStates: vi.fn().mockReturnValue({}),
}));
vi.mock('../slot-allocator.js', () => ({ calculateSlotBudget: vi.fn().mockReturnValue({ available: 4 }) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(), publishExecutorStatus: vi.fn(), publishCognitiveState: vi.fn(),
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue([]),
  generateDecision: vi.fn().mockResolvedValue(null),
  executeDecision: vi.fn(),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], risky: [] }),
}));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn().mockResolvedValue({ summary: 'ok' }) }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue({}) }));
vi.mock('../daily-review-scheduler.js', () => ({ triggerDailyReview: vi.fn().mockResolvedValue({}) }));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  getQuarantineStats: vi.fn().mockResolvedValue({}),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn(), getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../progress-ledger.js', () => ({ evaluateProgressInTick: vi.fn().mockResolvedValue([]) }));
vi.mock('../initiative-closer.js', () => ({
  checkInitiativeCompletion: vi.fn().mockResolvedValue({ closedCount: 0 }),
  checkProjectCompletion: vi.fn().mockResolvedValue({ closedCount: 0 }),
  activateNextInitiatives: vi.fn().mockResolvedValue({ activatedCount: 0 }),
}));
vi.mock('../goal-evaluator.js', () => ({
  evaluateGoalOuterLoop: vi.fn().mockResolvedValue([]),
  _resetGoalEvalTimes: vi.fn(),
}));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue({}) }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({}) }));

// ── 导入被测函数 ──────────────────────────────────────────────────────────────

import { executeTriage, cleanupExpiredSuggestions } from '../suggestion-triage.js';

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('Tick Suggestion Integration (v2 — L1 架构)', () => {
  let executeTick;

  beforeAll(async () => {
    const tickModule = await import('../tick.js');
    executeTick = tickModule.executeTick;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('suggestion triage 已从 tick 移除', () => {
    test('tick 不调用 executeTriage（信号源已直接接 L1）', async () => {
      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(executeTriage).not.toHaveBeenCalled();
    });

    test('tick 不调用 cleanupExpiredSuggestions', async () => {
      const result = await executeTick();

      expect(result.success).toBe(true);
      expect(cleanupExpiredSuggestions).not.toHaveBeenCalled();
    });

    test('tick 正常完成（无 suggestion 相关 action）', async () => {
      const result = await executeTick();

      expect(result.success).toBe(true);

      const suggestionActions = (result.actions_taken || []).filter(
        a => a.action === 'suggestion_triage' || a.action === 'suggestion_cleanup'
      );
      expect(suggestionActions).toHaveLength(0);
    });
  });
});
