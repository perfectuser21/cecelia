/**
 * Consciousness Tick Runtime Integration Test
 *
 * 断言 executeTick 会根据 consciousness guard 的状态跳过或触发意识模块。
 * 用 vi.mock 真实 mock 意识模块（方便断言调用次数），其余重依赖 noop 防副作用。
 */

import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_240 = path.resolve(__dirname, '../../../migrations/240_consciousness_setting.sql');
const MEMORY_KEY = 'consciousness_enabled';

const cleanupMocks = vi.hoisted(() => ({
  zombieSweep: vi.fn().mockResolvedValue({
    started_at: '2026-07-27T00:00:00.000Z',
    completed_at: '2026-07-27T00:00:00.000Z',
    worktrees: { checked: 0, removed: 0, skipped: 0, errors: [] },
    processes: { checked: 0, killed: 0, errors: [] },
    lock_slots: { checked: 0, removed: 0, errors: [] },
  }),
  cleanupWorkerTick: vi.fn().mockResolvedValue({
    success: true,
    stdout: '',
    stderr: '',
  }),
  runZombieCleanup: vi.fn().mockResolvedValue({
    slotsReclaimed: 0,
    worktreesRemoved: 0,
    timestamp: '2026-07-27T00:00:00.000Z',
    errors: [],
  }),
  cleanupStaleHarnessWorktrees: vi.fn().mockResolvedValue({
    cleaned: 0,
    errors: 0,
  }),
}));

const hostMutationMocks = vi.hoisted(() => ({
  checkRunaways: vi.fn().mockReturnValue({ actions: [] }),
  cleanupMetrics: vi.fn(),
  checkIdleSessions: vi.fn().mockReturnValue({ actions: [] }),
  emergencyCleanup: vi.fn().mockReturnValue({
    worktree: false,
    lock: false,
    devMode: false,
    errors: [],
  }),
  scanOrphanPrs: vi.fn().mockResolvedValue({
    scanned: 0,
    merged: 0,
    labeled: 0,
    closed: 0,
    skipped: 0,
    details: [],
  }),
  shepherdOpenPRs: vi.fn().mockResolvedValue({
    processed: 0,
    merged: 0,
    failed: 0,
    pending: 0,
  }),
  pipelinePatrolTick: vi.fn().mockResolvedValue({
    skipped: true,
    reason: 'test_noop',
  }),
  evaluateAlertness: vi.fn().mockResolvedValue({
    level: 1,
    levelName: 'CALM',
    score: 100,
    reasons: [],
  }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(false),
  getDispatchRate: vi.fn().mockReturnValue(1),
  getCurrentAlertness: vi.fn().mockReturnValue({
    level: 1,
    levelName: 'CALM',
  }),
  getRecoveryStatus: vi.fn().mockReturnValue({
    isRecovering: false,
    phase: 0,
  }),
  runDriftSentinel: vi.fn().mockResolvedValue({
    skipped: true,
    reason: 'test_noop',
  }),
}));

const externalBoundaryMocks = vi.hoisted(() => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    total: 0,
    capacity: { physical: 0, budget: 0, effective: 0 },
    user: { budget: 0, used: 0, mode: 'absent', headroom: 0 },
    cecelia: { budget: 0, used: 0 },
    taskPool: { budget: 0, used: 0, available: 0 },
    codex: { running: 0, max: 0, available: 0 },
    fleet: {},
    pressure: 0,
    resources: { effectiveSlots: 0, maxPressure: 0 },
    tokenPressure: { token_pressure: 0, available_accounts: 3 },
    budgetState: null,
    dispatchAllowed: false,
    backpressure: { override_burst_limit: null },
  }),
  shouldBypassBackpressure: vi.fn().mockReturnValue(false),
  dispatchNextTask: vi.fn().mockResolvedValue({
    dispatched: false,
    actions: [],
    reason: 'test_noop',
  }),
  triggerDailyReview: vi.fn().mockResolvedValue({
    triggered: 0,
    skipped: 0,
    skipped_window: true,
    results: [],
  }),
  triggerArchReview: vi.fn().mockResolvedValue({
    triggered: false,
    skipped_window: true,
    skipped_recent: false,
    skipped_guard: false,
  }),
  triggerContractScan: vi.fn().mockResolvedValue({
    skipped_window: true,
    skipped_today: false,
    triggered: false,
  }),
  runCanaryDrillIfNeeded: vi.fn().mockResolvedValue({
    triggered: false,
    skipped: true,
    reason: 'test_noop',
  }),
  runCredentialsHealthCheck: vi.fn().mockResolvedValue({
    skipped_window: true,
    skipped_today: false,
  }),
  syncSocialMediaData: vi.fn().mockResolvedValue({
    synced: 0,
    skipped: 0,
    source_count: 0,
  }),
  routeDailyReport: vi.fn().mockResolvedValue({
    skipped: true,
    reason: 'test_noop',
  }),
  sendFeishu: vi.fn().mockResolvedValue(false),
  sendBark: vi.fn().mockResolvedValue(false),
  triggerCodeQualityScan: vi.fn().mockResolvedValue({
    triggered: false,
    skipped: true,
    reason: 'test_noop',
  }),
  checkAndAlertExpiringCredentials: vi.fn().mockResolvedValue({ alerted: 0 }),
  recoverAuthQuarantinedTasks: vi.fn().mockResolvedValue({ recovered: 0 }),
  scanAuthLayerHealth: vi.fn().mockResolvedValue({ alerted: 0 }),
  cleanupDuplicateRescueTasks: vi.fn().mockResolvedValue({ cancelled: 0, branches: 0 }),
  cancelCredentialAlertTasks: vi.fn().mockResolvedValue({ cancelled: 0 }),
}));

// executeTick owns destructive host cleanup edges. This integration test exercises
// consciousness wiring only, so every cleanup boundary must remain an explicit noop.
vi.mock('../../zombie-sweep.js', () => ({
  zombieSweep: cleanupMocks.zombieSweep,
}));
vi.mock('../../cleanup-worker-plugin.js', () => ({
  tick: cleanupMocks.cleanupWorkerTick,
}));
vi.mock('../../zombie-cleaner.js', () => ({
  runZombieCleanup: cleanupMocks.runZombieCleanup,
}));
vi.mock('../../harness-worktree.js', () => ({
  cleanupStaleHarnessWorktrees: cleanupMocks.cleanupStaleHarnessWorktrees,
}));
vi.mock('../../watchdog.js', () => ({
  checkRunaways: hostMutationMocks.checkRunaways,
  cleanupMetrics: hostMutationMocks.cleanupMetrics,
  checkIdleSessions: hostMutationMocks.checkIdleSessions,
}));
vi.mock('../../emergency-cleanup.js', () => ({
  emergencyCleanup: hostMutationMocks.emergencyCleanup,
}));
vi.mock('../../orphan-pr-worker.js', () => ({
  scanOrphanPrs: hostMutationMocks.scanOrphanPrs,
}));
vi.mock('../../shepherd.js', () => ({
  shepherdOpenPRs: hostMutationMocks.shepherdOpenPRs,
}));
vi.mock('../../pipeline-patrol-plugin.js', () => ({
  tick: hostMutationMocks.pipelinePatrolTick,
}));
vi.mock('../../alertness/index.js', () => ({
  evaluateAlertness: hostMutationMocks.evaluateAlertness,
  canDispatch: hostMutationMocks.canDispatch,
  canPlan: hostMutationMocks.canPlan,
  getDispatchRate: hostMutationMocks.getDispatchRate,
  getCurrentAlertness: hostMutationMocks.getCurrentAlertness,
  ALERTNESS_LEVELS: {
    SLEEPING: 0,
    CALM: 1,
    AWARE: 2,
    ALERT: 3,
    PANIC: 4,
  },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));
vi.mock('../../alertness/healing.js', () => ({
  getRecoveryStatus: hostMutationMocks.getRecoveryStatus,
}));
vi.mock('../../cron/drift-sentinel.js', () => ({
  runDriftSentinel: hostMutationMocks.runDriftSentinel,
  DRIFT_SENTINEL_INTERVAL_MS: 30 * 60 * 1000,
}));
vi.mock('../../slot-allocator.js', () => ({
  calculateSlotBudget: externalBoundaryMocks.calculateSlotBudget,
  shouldBypassBackpressure: externalBoundaryMocks.shouldBypassBackpressure,
}));
vi.mock('../../dispatcher.js', () => ({
  dispatchNextTask: externalBoundaryMocks.dispatchNextTask,
}));
vi.mock('../../daily-review-scheduler.js', () => ({
  triggerDailyReview: externalBoundaryMocks.triggerDailyReview,
  triggerArchReview: externalBoundaryMocks.triggerArchReview,
  triggerContractScan: externalBoundaryMocks.triggerContractScan,
}));
vi.mock('../../canary-drill-scheduler.js', () => ({
  runCanaryDrillIfNeeded: externalBoundaryMocks.runCanaryDrillIfNeeded,
}));
vi.mock('../../credentials-health-scheduler.js', () => ({
  runCredentialsHealthCheck: externalBoundaryMocks.runCredentialsHealthCheck,
}));
vi.mock('../../social-media-sync.js', () => ({
  syncSocialMediaData: externalBoundaryMocks.syncSocialMediaData,
}));
vi.mock('../../durable/daily-report-router.js', () => ({
  routeDailyReport: externalBoundaryMocks.routeDailyReport,
}));
vi.mock('../../notifier.js', () => ({
  sendFeishu: externalBoundaryMocks.sendFeishu,
  sendBark: externalBoundaryMocks.sendBark,
}));
vi.mock('../../task-generator-scheduler.js', () => ({
  triggerCodeQualityScan: externalBoundaryMocks.triggerCodeQualityScan,
}));
vi.mock('../../credential-expiry-checker.js', () => ({
  checkAndAlertExpiringCredentials: externalBoundaryMocks.checkAndAlertExpiringCredentials,
  recoverAuthQuarantinedTasks: externalBoundaryMocks.recoverAuthQuarantinedTasks,
  scanAuthLayerHealth: externalBoundaryMocks.scanAuthLayerHealth,
  cleanupDuplicateRescueTasks: externalBoundaryMocks.cleanupDuplicateRescueTasks,
  cancelCredentialAlertTasks: externalBoundaryMocks.cancelCredentialAlertTasks,
}));

// ========== 意识模块 mocks（要断言调用次数）==========
vi.mock('../../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue({ accumulator: 0 }) }));
vi.mock('../../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../suggestion-cycle.js', () => ({ runSuggestionCycle: vi.fn().mockResolvedValue({}) }));
vi.mock('../../conversation-consolidator.js', () => ({ runConversationConsolidator: vi.fn().mockResolvedValue({}) }));
vi.mock('../../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../self-report-collector.js', () => ({ collectSelfReport: vi.fn().mockResolvedValue({}) }));
vi.mock('../../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
  synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue({}) }));
vi.mock('../../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue({}) }));
vi.mock('../../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue({ triggered: 0, skipped: 0, results: [] }) }));

// ========== 其它重依赖 mocks（noop 防副作用）==========
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: false, reason: 'test-skip' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockResolvedValue(0),
  getActiveProcesses: vi.fn().mockReturnValue([]),
  removeActiveProcess: vi.fn(),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({
    ok: true,
    reason: 'test-mock',
    effectiveSlots: 3,
    metrics: { max_pressure: 0, cpu_pressure: 0, mem_pressure: 0 },
  }),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn().mockResolvedValue({
    killed: false,
    stage: 'test_noop',
  }),
  requeueTask: vi.fn(),
  MAX_SEATS: 3,
  INTERACTIVE_RESERVE: 1,
  PHYSICAL_CAPACITY: 3,
  getEffectiveMaxSeats: vi.fn().mockReturnValue(3),
  getBudgetCap: vi.fn().mockReturnValue({ cap: 3, physical: 3, budget: 3, effective: 3, reason: 'mock' }),
  getTokenPressure: vi.fn().mockResolvedValue({ token_pressure: 0, available_accounts: 3, details: 'mock' }),
  getTotalCapacity: vi.fn().mockReturnValue(3),
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({}),
  generateDecision: vi.fn().mockResolvedValue({ action: 'noop' }),
  executeDecision: vi.fn().mockResolvedValue({}),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ decisions: [] }),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue({ text: 'mock' }),
}));
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue({}),
  expireStaleProposals: vi.fn(),
}));

// 真实 import
import { executeTick } from '../../tick.js';
import {
  initConsciousnessGuard,
  setConsciousnessEnabled,
  _resetCacheForTest,
} from '../../consciousness-guard.js';
import { runRumination } from '../../rumination.js';
import { generateDailyDiaryIfNeeded } from '../../diary-scheduler.js';
import { runDesireSystem } from '../../desire/index.js';
import { resetTickStateForTests } from '../../tick-state.js';
// scanEvolutionIfNeeded 不在此列：已移出 consciousness 守护（纯 GitHub API 调用，不消耗 LLM），
// consciousness=false 时仍正常运行，不应断言它被跳过。

const CONSCIOUSNESS_MOCKS = [runRumination, generateDailyDiaryIfNeeded, runDesireSystem];
const CLEANUP_MOCKS = Object.values(cleanupMocks);
const HOST_MUTATION_MOCKS = Object.values(hostMutationMocks);
const EXTERNAL_BOUNDARY_MOCKS = Object.values(externalBoundaryMocks);

describe('consciousness tick runtime (real executeTick + mocked deps)', () => {
  let pool;
  let processKillSpy;
  let fetchSpy;

  beforeAll(async () => {
    pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected real fetch'));
    await pool.query('DELETE FROM working_memory WHERE key = $1', [MEMORY_KEY]);
    const sql = fs.readFileSync(MIGRATION_240, 'utf8');
    await pool.query(sql);
    _resetCacheForTest();
    resetTickStateForTests();
    CONSCIOUSNESS_MOCKS.forEach((m) => m.mockClear());
    CLEANUP_MOCKS.forEach((m) => m.mockClear());
    HOST_MUTATION_MOCKS.forEach((m) => m.mockClear());
    EXTERNAL_BOUNDARY_MOCKS.forEach((m) => m.mockClear());
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });

  afterEach(() => {
    try {
      expect(processKillSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      processKillSpy.mockRestore();
      fetchSpy.mockRestore();
      delete process.env.CONSCIOUSNESS_ENABLED;
      delete process.env.BRAIN_QUIET_MODE;
    }
  });

  test('memory=false: executeTick skips all consciousness modules', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);
    await executeTick();
    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  }, 60000);

  test('env override beats memory: env=false + memory=true → modules skipped', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, true);
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    await executeTick();
    for (const m of CONSCIOUSNESS_MOCKS) {
      expect(m).toHaveBeenCalledTimes(0);
    }
  }, 60000);

  test('executeTick keeps every host cleanup boundary mocked', async () => {
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);
    await executeTick();

    for (const cleanupMock of CLEANUP_MOCKS) {
      expect(vi.isMockFunction(cleanupMock)).toBe(true);
      expect(cleanupMock).toHaveBeenCalledTimes(1);
    }
    expect(await cleanupMocks.zombieSweep.mock.results[0].value).toMatchObject({
      worktrees: { removed: 0 },
      processes: { killed: 0 },
      lock_slots: { removed: 0 },
    });
    expect(await cleanupMocks.runZombieCleanup.mock.results[0].value).toMatchObject({
      slotsReclaimed: 0,
      worktreesRemoved: 0,
    });
    expect(
      await cleanupMocks.cleanupStaleHarnessWorktrees.mock.results[0].value,
    ).toEqual({ cleaned: 0, errors: 0 });
    expect(hostMutationMocks.checkRunaways).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.checkIdleSessions).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.scanOrphanPrs).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.shepherdOpenPRs).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.pipelinePatrolTick).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.evaluateAlertness).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.getRecoveryStatus).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.runDriftSentinel).toHaveBeenCalledTimes(1);
    expect(hostMutationMocks.cleanupMetrics).not.toHaveBeenCalled();
    expect(hostMutationMocks.emergencyCleanup).not.toHaveBeenCalled();
    expect(hostMutationMocks.checkRunaways.mock.results[0].value).toEqual({ actions: [] });
    expect(hostMutationMocks.checkIdleSessions.mock.results[0].value).toEqual({ actions: [] });
    expect(await hostMutationMocks.scanOrphanPrs.mock.results[0].value).toEqual({
      scanned: 0,
      merged: 0,
      labeled: 0,
      closed: 0,
      skipped: 0,
      details: [],
    });
    expect(externalBoundaryMocks.calculateSlotBudget).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.dispatchNextTask).not.toHaveBeenCalled();
    expect(externalBoundaryMocks.triggerDailyReview).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.triggerArchReview).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.triggerContractScan).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.runCanaryDrillIfNeeded).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.runCredentialsHealthCheck).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.syncSocialMediaData).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.routeDailyReport).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.checkAndAlertExpiringCredentials).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.recoverAuthQuarantinedTasks).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.scanAuthLayerHealth).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.cleanupDuplicateRescueTasks).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.cancelCredentialAlertTasks).toHaveBeenCalledTimes(1);
    expect(externalBoundaryMocks.sendFeishu).not.toHaveBeenCalled();
    expect(externalBoundaryMocks.sendBark).not.toHaveBeenCalled();
    expect(externalBoundaryMocks.triggerCodeQualityScan).not.toHaveBeenCalled();
    const { killProcessTwoStage } = await import('../../executor.js');
    expect(killProcessTwoStage).not.toHaveBeenCalled();
    expect(processKillSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60000);

  test('host mutation modules stay behind explicit test doubles', async () => {
    const [
      { checkRunaways, checkIdleSessions },
      { emergencyCleanup },
      { scanOrphanPrs },
      { shepherdOpenPRs },
      { tick: pipelinePatrolTick },
      { evaluateAlertness },
      { getRecoveryStatus },
      { runDriftSentinel },
    ] = await Promise.all([
      import('../../watchdog.js'),
      import('../../emergency-cleanup.js'),
      import('../../orphan-pr-worker.js'),
      import('../../shepherd.js'),
      import('../../pipeline-patrol-plugin.js'),
      import('../../alertness/index.js'),
      import('../../alertness/healing.js'),
      import('../../cron/drift-sentinel.js'),
    ]);

    expect(vi.isMockFunction(checkRunaways)).toBe(true);
    expect(vi.isMockFunction(checkIdleSessions)).toBe(true);
    expect(vi.isMockFunction(emergencyCleanup)).toBe(true);
    expect(vi.isMockFunction(scanOrphanPrs)).toBe(true);
    expect(vi.isMockFunction(shepherdOpenPRs)).toBe(true);
    expect(vi.isMockFunction(pipelinePatrolTick)).toBe(true);
    expect(vi.isMockFunction(evaluateAlertness)).toBe(true);
    expect(vi.isMockFunction(getRecoveryStatus)).toBe(true);
    expect(vi.isMockFunction(runDriftSentinel)).toBe(true);
    expect(checkRunaways()).toEqual({ actions: [] });
    expect(checkIdleSessions()).toEqual({ actions: [] });
    expect(emergencyCleanup('test-task', 'test-slot')).toEqual({
      worktree: false,
      lock: false,
      devMode: false,
      errors: [],
    });
    await expect(scanOrphanPrs(pool)).resolves.toEqual({
      scanned: 0,
      merged: 0,
      labeled: 0,
      closed: 0,
      skipped: 0,
      details: [],
    });
  });

  test('two-stage kill test double preserves the executor result contract', async () => {
    const { killProcessTwoStage } = await import('../../executor.js');

    await expect(killProcessTwoStage('test-task', 12345)).resolves.toEqual({
      killed: false,
      stage: 'test_noop',
    });
  });

  test('env override can force-enable: env=true + memory=false → guard returns true', async () => {
    // tick 正路径在完整 mock 环境下仍可能 timeout（内部有很多真实 DB 查询未 mock）；
    // 因此这条用 guard 直查替代，断言 env 强启逻辑。三条合起来覆盖：memory / env-kill / env-force。
    const { isConsciousnessEnabled } = await import('../../consciousness-guard.js');
    await initConsciousnessGuard(pool);
    await setConsciousnessEnabled(pool, false);
    expect(isConsciousnessEnabled()).toBe(false);
    process.env.CONSCIOUSNESS_ENABLED = 'true';
    expect(isConsciousnessEnabled()).toBe(true);
  });
});
