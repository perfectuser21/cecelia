/**
 * tick-billing-pause 单元测试
 * D1: billing pause active 时 dispatchNextTask 返回 dispatched=false
 * D2: billing pause inactive 时 dispatchNextTask 不受影响（正常走 slot 检查）
 * D3: tick 源码包含 billing pause 检查
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── billing pause mock （可动态切换）─────────────────────
const getBillingPauseMock = vi.fn(() => ({ active: false }));

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue({ rows: [] }),
  getEventCounts: vi.fn().mockResolvedValue([]),
}));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: false }),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  killProcess: vi.fn(),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  probeTaskLiveness: vi.fn(),
  syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 4,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: getBillingPauseMock,
}));
vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockReturnValue({
    dispatchAllowed: true,
    taskPool: { budget: 4, available: 2 },
    user: { mode: 'absent', used: 0 },
  }),
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({ overall_health: 'healthy', next_actions: [], goals: [] }),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  splitActionsBySafety: vi.fn().mockReturnValue({ safeActions: [], unsafeActions: [] }),
}));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn().mockReturnValue(true),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
  publishTaskProgress: vi.fn(),
  publishCognitiveState: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
  expireStaleProposals: vi.fn().mockResolvedValue(0),
}));
vi.mock('../alertness/index.js', () => ({
  initAlertness: vi.fn(),
  evaluateAlertness: vi.fn().mockResolvedValue({ level: 0, levelName: 'CALM' }),
  getCurrentAlertness: vi.fn().mockReturnValue({ level: 0, levelName: 'CALM' }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1),
  ALERTNESS_LEVELS: { ALERT: 3 },
  LEVEL_NAMES: {},
}));
vi.mock('../alertness/metrics.js', () => ({ recordTickTime: vi.fn(), recordOperation: vi.fn() }));
vi.mock('../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ isRecovering: false }),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../health-monitor.js', () => ({ runLayer2HealthCheck: vi.fn().mockResolvedValue({}) }));
vi.mock('../dept-heartbeat.js', () => ({ triggerDeptHeartbeats: vi.fn().mockResolvedValue([]) }));
vi.mock('../daily-review-scheduler.js', () => ({
  triggerDailyReview: vi.fn().mockResolvedValue(null),
  triggerContractScan: vi.fn().mockResolvedValue(null),
}));
vi.mock('../desire/index.js', () => ({ runDesireSystem: vi.fn().mockResolvedValue(null) }));
vi.mock('../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue(null) }));
vi.mock('../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../cognitive-core.js', () => ({
  evaluateEmotion: vi.fn().mockResolvedValue({}),
  getCurrentEmotion: vi.fn().mockReturnValue({}),
  updateSubjectiveTime: vi.fn(),
  getSubjectiveTime: vi.fn().mockReturnValue({}),
  getParallelAwareness: vi.fn().mockReturnValue([]),
  getTrustScores: vi.fn().mockReturnValue({}),
  updateNarrative: vi.fn(),
  recordTickEvent: vi.fn(),
  getCognitiveSnapshot: vi.fn().mockReturnValue({}),
}));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: vi.fn().mockResolvedValue(null) }));
vi.mock('../consolidation.js', () => ({ runDailyConsolidationIfNeeded: vi.fn().mockResolvedValue(null) }));
vi.mock('../task-weight.js', () => ({ sortTasksByWeight: vi.fn(tasks => tasks) }));
vi.mock('../alerting.js', () => ({ flushAlertsIfNeeded: vi.fn().mockResolvedValue(null), raise: vi.fn() }));
vi.mock('../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn().mockResolvedValue(null),
  synthesizeEvolutionIfNeeded: vi.fn().mockResolvedValue(null),
}));
vi.mock('../task-generator-scheduler.js', () => ({
  triggerCodeQualityScan: vi.fn().mockResolvedValue(null),
  getScannerStatus: vi.fn().mockReturnValue({}),
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn().mockResolvedValue(null) }));
vi.mock('../actions.js', () => ({ updateTask: vi.fn(), createTask: vi.fn() }));
vi.mock('../shepherd.js', () => ({
  shepherdOpenPRs: vi.fn().mockResolvedValue({ processed: 0, merged: 0, failed: 0, pending: 0 }),
}));
vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
  unblockTask: vi.fn(),
  unblockExpiredTasks: vi.fn().mockResolvedValue([]),
}));

// ── 导入被测函数 ──────────────────────────────────────────
let dispatchNextTask;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../tick.js');
  dispatchNextTask = mod.dispatchNextTask;
});

// ── 测试 ─────────────────────────────────────────────────

describe('dispatchNextTask — billing pause active 时零派发', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认：billing pause 未激活
    getBillingPauseMock.mockReturnValue({ active: false });
  });

  it('billing pause active 时应立即返回 dispatched=false', async () => {
    getBillingPauseMock.mockReturnValue({
      active: true,
      resetTime: new Date(Date.now() + 3600000).toISOString(),
      reason: 'quota_exhausted',
    });

    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('billing_pause');
  });

  it('billing pause active 时 detail 应包含 resetTime', async () => {
    const resetTime = new Date(Date.now() + 3600000).toISOString();
    getBillingPauseMock.mockReturnValue({ active: true, resetTime, reason: 'quota_exhausted' });

    const result = await dispatchNextTask([]);

    expect(result.detail).toContain(resetTime);
  });

  it('billing pause inactive 时不因 billing pause 短路（可继续走 slot 检查）', async () => {
    getBillingPauseMock.mockReturnValue({ active: false });

    const result = await dispatchNextTask([]);

    // 不应因 billing_pause 返回
    expect(result.reason).not.toBe('billing_pause');
  });
});

describe('tick.js 源码 — billing pause 检查存在', () => {
  it('tick.js dispatchNextTask 应调用 getBillingPause()', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain('getBillingPause()');
    expect(src).toContain('billing_pause');
  });

  it('tick.js 应有 quota_exhausted requeue 逻辑', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../tick.js', import.meta.url), 'utf-8');
    expect(src).toContain("status = 'quota_exhausted'");
    expect(src).toContain('quota_exhausted requeue');
  });
});
