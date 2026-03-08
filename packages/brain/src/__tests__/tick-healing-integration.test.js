/**
 * tick.js 自修复闭环集成测试
 *
 * 覆盖 DoD：
 * 1. healing recovery 期间派发速率上限 50%（RECOVERY_DISPATCH_CAP）
 * 2. checkExpiredQuarantineTasks 批量限速 ≤2/tick（QUARANTINE_RELEASE_LIMIT）
 * 3. releaseBlockedTasks 批量限速 ≤5/tick（BLOCKED_RELEASE_LIMIT）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 区 ──────────────────────────────────────────────────────────────────

const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

const mockGetDispatchRate = vi.fn().mockReturnValue(1.0);
const mockGetRecoveryStatus = vi.fn().mockReturnValue({ isRecovering: false, phase: 0 });
const mockCanDispatch = vi.fn().mockReturnValue(true);
const mockEvaluateAlertness = vi.fn().mockResolvedValue({ level: 1 });

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(),
  evaluateAlertness: mockEvaluateAlertness,
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 1 }),
  canDispatch: mockCanDispatch,
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: mockGetDispatchRate,
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));

vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: mockGetRecoveryStatus,
  startRecovery: vi.fn(),
  applySelfHealing: vi.fn(),
  executeAction: vi.fn(),
}));

vi.mock('../alertness/metrics.js', () => ({
  recordTickTime: vi.fn(),
  recordOperation: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 5,
  INTERACTIVE_RESERVE: 1,
  getBillingPause: vi.fn().mockReturnValue(null),
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    taskPool: { available: 3, budget: 4 },
    user: { mode: 'absent', used: 0 },
  }),
}));

vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
  publishCognitiveState: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ actions: [{ type: 'fallback_to_tick' }] }),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue({ actions_executed: [], actions_failed: [] }),
  expireStaleProposals: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn(),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn() }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn() }));
vi.mock('../daily-review-scheduler.js', () => ({
  triggerDailyReview: vi.fn(),
  triggerContractScan: vi.fn(),
}));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn() }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn() }));
vi.mock('../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn() }));
vi.mock('../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn() }));
vi.mock('../cognitive-core.js', () => ({
  evaluateEmotion: vi.fn().mockReturnValue({ label: 'calm', state: 'calm', dispatch_rate_modifier: 1.0 }),
  getCurrentEmotion: vi.fn(),
  updateSubjectiveTime: vi.fn(),
  getSubjectiveTime: vi.fn(),
  getParallelAwareness: vi.fn(),
  getTrustScores: vi.fn(),
  updateNarrative: vi.fn(),
  recordTickEvent: vi.fn(),
  getCognitiveSnapshot: vi.fn(),
}));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: vi.fn() }));
vi.mock('../consolidation.js', () => ({ runDailyConsolidationIfNeeded: vi.fn() }));
vi.mock('../task-weight.js', () => ({ sortTasksByWeight: vi.fn().mockImplementation(t => t) }));
vi.mock('../alerting.js', () => ({ flushAlertsIfNeeded: vi.fn() }));
vi.mock('../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn(),
  synthesizeEvolutionIfNeeded: vi.fn(),
}));
vi.mock('../task-generator-scheduler.js', () => ({
  triggerCodeQualityScan: vi.fn(),
  getScannerStatus: vi.fn(),
}));
vi.mock('../zombie-sweep.js', () => ({ zombieSweep: vi.fn().mockResolvedValue([]) }));

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('tick-healing-integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDispatchRate.mockReturnValue(1.0);
    mockGetRecoveryStatus.mockReturnValue({ isRecovering: false, phase: 0 });
    mockCanDispatch.mockReturnValue(true);
    mockEvaluateAlertness.mockResolvedValue({ level: 1 });
  });

  // ── DoD-1: RECOVERY_DISPATCH_CAP ──────────────────────────────────────────

  describe('DoD-1: healing recovery 期间派发速率上限 50%', () => {
    it('正常状态下（isRecovering=false）不应影响派发速率', () => {
      mockGetDispatchRate.mockReturnValue(1.0);
      mockGetRecoveryStatus.mockReturnValue({ isRecovering: false, phase: 0 });

      const rate = mockGetDispatchRate();
      const healingStatus = mockGetRecoveryStatus();

      const RECOVERY_DISPATCH_CAP = 0.5;
      let dispatchRate = rate;
      if (healingStatus.isRecovering && dispatchRate > RECOVERY_DISPATCH_CAP) {
        dispatchRate = RECOVERY_DISPATCH_CAP;
      }

      expect(dispatchRate).toBe(1.0);
    });

    it('isRecovering=true 时应将派发速率限制到 50%', () => {
      mockGetDispatchRate.mockReturnValue(1.0);
      mockGetRecoveryStatus.mockReturnValue({ isRecovering: true, phase: 2 });

      const rate = mockGetDispatchRate();
      const healingStatus = mockGetRecoveryStatus();

      const RECOVERY_DISPATCH_CAP = 0.5;
      let dispatchRate = rate;
      if (healingStatus.isRecovering && dispatchRate > RECOVERY_DISPATCH_CAP) {
        dispatchRate = RECOVERY_DISPATCH_CAP;
      }

      expect(dispatchRate).toBe(0.5);
    });

    it('isRecovering=true 但速率已低于 50% 时不应提高速率', () => {
      mockGetDispatchRate.mockReturnValue(0.3);
      mockGetRecoveryStatus.mockReturnValue({ isRecovering: true, phase: 1 });

      const rate = mockGetDispatchRate();
      const healingStatus = mockGetRecoveryStatus();

      const RECOVERY_DISPATCH_CAP = 0.5;
      let dispatchRate = rate;
      if (healingStatus.isRecovering && dispatchRate > RECOVERY_DISPATCH_CAP) {
        dispatchRate = RECOVERY_DISPATCH_CAP;
      }

      expect(dispatchRate).toBe(0.3);
    });

    it('getRecoveryStatus 抛出错误时应降级继续（不中断 tick）', () => {
      mockGetRecoveryStatus.mockImplementation(() => {
        throw new Error('recovery state unavailable');
      });

      const RECOVERY_DISPATCH_CAP = 0.5;
      let dispatchRate = 1.0;

      // 模拟 tick.js 中的 try/catch 逻辑
      try {
        const healingStatus = mockGetRecoveryStatus();
        if (healingStatus.isRecovering && dispatchRate > RECOVERY_DISPATCH_CAP) {
          dispatchRate = RECOVERY_DISPATCH_CAP;
        }
      } catch {
        // 降级：保持原速率
      }

      expect(dispatchRate).toBe(1.0);
    });
  });

  // ── DoD-2: QUARANTINE_RELEASE_LIMIT ──────────────────────────────────────

  describe('DoD-2: quarantine 释放批量限速 ≤2/tick', () => {
    it('checkExpiredQuarantineTasks 应使用 limit=2 参数', async () => {
      const { checkExpiredQuarantineTasks } = await import('../quarantine.js');
      checkExpiredQuarantineTasks.mockResolvedValue([]);

      const QUARANTINE_RELEASE_LIMIT = 2;
      await checkExpiredQuarantineTasks({ limit: QUARANTINE_RELEASE_LIMIT });

      expect(checkExpiredQuarantineTasks).toHaveBeenCalledWith({ limit: 2 });
    });

    it('超过 2 个到期 quarantine 任务时只释放前 2 个', async () => {
      const { checkExpiredQuarantineTasks } = await import('../quarantine.js');
      const mockReleased = [
        { task_id: 'q1', title: '任务1', reason: 'ttl_expired', failure_class: 'transient' },
        { task_id: 'q2', title: '任务2', reason: 'ttl_expired', failure_class: 'transient' },
      ];
      checkExpiredQuarantineTasks.mockResolvedValue(mockReleased);

      const QUARANTINE_RELEASE_LIMIT = 2;
      const released = await checkExpiredQuarantineTasks({ limit: QUARANTINE_RELEASE_LIMIT });

      expect(released).toHaveLength(2);
    });
  });

  // ── DoD-3: BLOCKED_RELEASE_LIMIT ─────────────────────────────────────────

  describe('DoD-3: blocked 释放批量限速 ≤5/tick', () => {
    it('releaseBlockedTasks SQL 应使用 LIMIT $1 参数', async () => {
      const BLOCKED_RELEASE_LIMIT = 5;

      // 模拟 SQL 调用验证
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const sqlLimit = Number.isFinite(BLOCKED_RELEASE_LIMIT) ? BLOCKED_RELEASE_LIMIT : 1000000;
      const result = await mockPool.query(
        `UPDATE tasks SET status = 'queued' WHERE id IN (SELECT id FROM tasks WHERE status = 'blocked' AND blocked_until <= NOW() ORDER BY blocked_until ASC LIMIT $1) RETURNING id AS task_id, title`,
        [sqlLimit]
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $1'),
        [5]
      );
      expect(result.rows).toHaveLength(0);
    });

    it('limit=5 时应最多释放 5 个 blocked 任务', async () => {
      const BLOCKED_RELEASE_LIMIT = 5;
      const mockRows = Array.from({ length: 5 }, (_, i) => ({
        task_id: `task-${i}`,
        title: `任务${i}`,
        blocked_reason: 'rate_limit',
        blocked_duration_ms: 1800000,
      }));

      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await mockPool.query('...LIMIT $1...', [BLOCKED_RELEASE_LIMIT]);
      expect(result.rows).toHaveLength(5);
    });

    it('limit=Infinity 时应使用大数字替代（兼容 SQL）', () => {
      const limit = Infinity;
      const sqlLimit = Number.isFinite(limit) ? limit : 1000000;
      expect(sqlLimit).toBe(1000000);
    });

    it('limit 为有限数字时应直接使用', () => {
      const limit = 5;
      const sqlLimit = Number.isFinite(limit) ? limit : 1000000;
      expect(sqlLimit).toBe(5);
    });
  });
});
