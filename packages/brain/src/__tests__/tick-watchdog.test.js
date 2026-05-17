/**
 * Tick Watchdog Tests
 *
 * 测试独立 tick watchdog timer：
 * - drain/alertness source 禁用 tick 时自动恢复
 * - manual source 禁用 tick 时保持禁用（不自动恢复）
 * - 已启用的 tick 不触发恢复
 * - startTickWatchdog 幂等（不重复启动）
 * - stopTickWatchdog 停止定时器
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── DB mock ──────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// ── Static dependency mocks ───────────────────────────────────
vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));

vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue(null),
}));

vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, runId: 'run-test' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  }),
}));

vi.mock('../token-budget-planner.js', () => ({
  shouldDowngrade: vi.fn().mockReturnValue(false),
}));

vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue([]),
  generateDecision: vi.fn().mockResolvedValue(null),
  executeDecision: vi.fn().mockResolvedValue(null),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));

vi.mock('../planner.js', () => ({
  planNextTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined),
}));

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
  processEvent: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: {},
}));

vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
  expireStaleProposals: vi.fn().mockResolvedValue(null),
}));

vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn().mockResolvedValue(undefined),
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 'ACTIVE', dispatch_rate: 1.0 }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 'ACTIVE', dispatch_rate: 1.0 }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1.0),
  ALERTNESS_LEVELS: { ACTIVE: 'ACTIVE', ALERT: 'ALERT', PANIC: 'PANIC', COMA: 'COMA' },
  LEVEL_NAMES: { ACTIVE: 'ACTIVE', ALERT: 'ALERT', PANIC: 'PANIC', COMA: 'COMA' },
}));

vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ in_recovery: false }),
}));

vi.mock('../alertness/metrics.js', () => ({
  recordTickTime: vi.fn(),
  recordOperation: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue(null),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));

vi.mock('../health-monitor.js', () => ({
  runLayer2HealthCheck: vi.fn().mockResolvedValue(null),
}));

vi.mock('../dept-heartbeat.js', () => ({
  triggerDeptHeartbeats: vi.fn().mockResolvedValue(null),
}));

vi.mock('../daily-review-scheduler.js', () => ({
  triggerDailyReview: vi.fn().mockResolvedValue(null),
  triggerContractScan: vi.fn().mockResolvedValue(null),
}));

vi.mock('../topic-selection-scheduler.js', () => ({
  triggerDailyTopicSelection: vi.fn().mockResolvedValue(null),
}));

vi.mock('../desire/index.js', () => ({
  runDesireSystem: vi.fn().mockResolvedValue(null),
}));

vi.mock('../rumination.js', () => ({
  runRumination: vi.fn().mockResolvedValue(null),
}));

vi.mock('../rumination-scheduler.js', () => ({
  runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock('../notebook-feeder.js', () => ({
  feedDailyIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock('../cognitive-core.js', () => ({
  evaluateEmotion: vi.fn().mockResolvedValue(null),
  getCurrentEmotion: vi.fn().mockReturnValue(null),
  updateSubjectiveTime: vi.fn(),
  getSubjectiveTime: vi.fn().mockReturnValue(null),
  getParallelAwareness: vi.fn().mockReturnValue(null),
  getTrustScores: vi.fn().mockReturnValue([]),
  updateNarrative: vi.fn().mockResolvedValue(null),
  recordTickEvent: vi.fn().mockResolvedValue(null),
  getCognitiveSnapshot: vi.fn().mockReturnValue(null),
}));

vi.mock('../self-report-collector.js', () => ({
  collectSelfReport: vi.fn().mockResolvedValue(null),
}));

vi.mock('../consolidation.js', () => ({
  runDailyConsolidationIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock('../task-weight.js', () => ({
  sortTasksByWeight: vi.fn().mockImplementation((tasks) => tasks),
}));

vi.mock('../alerting.js', () => ({
  flushAlertsIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock('../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue(null),
  synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue(null),
}));

vi.mock('../task-generator-scheduler.js', () => ({
  triggerCodeQualityScan: vi.fn().mockResolvedValue(null),
  getScannerStatus: vi.fn().mockReturnValue(null),
}));

vi.mock('../zombie-sweep.js', () => ({
  zombieSweep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../pipeline-patrol.js', () => ({
  runPipelinePatrol: vi.fn().mockResolvedValue(null),
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

// ── Import tick functions after mocks ─────────────────────────
let startTickWatchdog, stopTickWatchdog, stopTickLoop, TICK_WATCHDOG_INTERVAL_MS;

describe('tick watchdog', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: DB queries return empty rows (safe for INSERT/UPDATE/SELECT without tick data)
    mockQuery.mockResolvedValue({ rows: [] });

    const tick = await import('../tick.js');
    startTickWatchdog = tick.startTickWatchdog;
    stopTickWatchdog = tick.stopTickWatchdog;
    stopTickLoop = tick.stopTickLoop;
    TICK_WATCHDOG_INTERVAL_MS = tick.TICK_WATCHDOG_INTERVAL_MS;
  });

  afterEach(() => {
    stopTickWatchdog();
    stopTickLoop();
    vi.useRealTimers();
  });

  it('watchdog 在 drain source 禁用 tick 时自动恢复', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return {
          rows: [{
            value_json: {
              enabled: false,
              source: 'drain',
              disabled_at: new Date().toISOString(),
            }
          }]
        };
      }
      return { rows: [] };
    });

    startTickWatchdog();
    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    // enableTick() should have called INSERT into working_memory with enabled: true
    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBeGreaterThan(0);
  });

  it('watchdog 在 alertness source 禁用 tick 时自动恢复', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return {
          rows: [{
            value_json: {
              enabled: false,
              source: 'alertness',
              disabled_at: new Date().toISOString(),
            }
          }]
        };
      }
      return { rows: [] };
    });

    startTickWatchdog();
    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBeGreaterThan(0);
  });

  it('watchdog 在 manual source 禁用 tick 时不自动恢复', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return {
          rows: [{
            value_json: {
              enabled: false,
              source: 'manual',
              disabled_at: new Date().toISOString(),
            }
          }]
        };
      }
      return { rows: [] };
    });

    startTickWatchdog();
    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    // manual disable — enableTick must NOT have been called
    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBe(0);
  });

  it('watchdog 在 tick 已启用时不触发恢复', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return { rows: [{ value_json: { enabled: true } }] };
      }
      return { rows: [] };
    });

    startTickWatchdog();
    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBe(0);
  });

  it('startTickWatchdog 幂等（重复调用不启动多个定时器）', async () => {
    startTickWatchdog();
    startTickWatchdog(); // second call must be no-op

    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return { rows: [{ value_json: { enabled: false, source: 'drain' } }] };
      }
      return { rows: [] };
    });

    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    // Only one interval should be firing — exactly one recovery
    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBe(1);
  });

  it('stopTickWatchdog 停止后不再触发恢复', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT')) {
        return { rows: [{ value_json: { enabled: false, source: 'drain' } }] };
      }
      return { rows: [] };
    });

    startTickWatchdog();
    stopTickWatchdog(); // stop before timer fires

    await vi.advanceTimersByTimeAsync(TICK_WATCHDOG_INTERVAL_MS + 100);

    const enableCalls = mockQuery.mock.calls.filter(
      call => typeof call[0] === 'string' &&
              call[0].includes('working_memory') &&
              call[1]?.[1]?.enabled === true
    );
    expect(enableCalls.length).toBe(0);
  });

  it('TICK_WATCHDOG_INTERVAL_MS 默认为 5 分钟', () => {
    expect(TICK_WATCHDOG_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
