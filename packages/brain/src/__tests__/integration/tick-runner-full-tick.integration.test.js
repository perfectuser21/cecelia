/**
 * Integration Test: tick-runner executeTick — 完整 1 次 tick 全 plugin wire
 *
 * 验证 D1.7c plugin 拆解后，executeTick 一次调用确实把 8 个 plugin 全 wire 上：
 *   - dept-heartbeat / kr-progress-sync / heartbeat / goal-eval
 *   - pipeline-patrol / pipeline-watchdog / kr-health-daily / cleanup-worker
 *
 * 同时验证：
 *   - dispatcher.dispatchNextTask 被调（行动层入口）
 *   - tickState 时间戳被推进（运行确实跑过感知层）
 *
 * 设计要点：
 *   - 全 mock 模式 — pool/spawn/8 plugin/dispatcher/heavy modules 全 stub，
 *     不真连 PG/Docker/网络
 *   - 测试关注"wire 是否对"，不测 plugin 内部逻辑（plugin 自有单测）
 *   - 不开 MINIMAL_MODE — 必须能完整跑过感知层并触达行动层
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Pool（防真连 PostgreSQL） ─────────────────────────────────────────
// 实现智能 mock：
//  - SELECT id FROM key_results 返 1 条（让 allGoalIds 非空，避免 tick 早退 line 1033）
//  - 其它 SELECT 默认返空
//  - INSERT/UPDATE 返 rowCount 0
//  - 计数类 SELECT (COUNT(*)) 返 [{ cnt: 0, count: 0, completed: 0, failed: 0 }]
function smartQuery(sql, _params) {
  const text = String(sql || '').toLowerCase();
  if (text.includes('count(*)') || text.includes('count(') || text.match(/\bcount\b/)) {
    return Promise.resolve({
      rows: [{ cnt: '0', count: '0', completed: '0', failed: '0' }],
      rowCount: 1,
    });
  }
  if (text.includes('select id from key_results')) {
    return Promise.resolve({ rows: [{ id: 'mock-kr-1' }], rowCount: 1 });
  }
  if (text.includes('run_periodic_cleanup')) {
    return Promise.resolve({ rows: [{ msg: 'done' }], rowCount: 1 });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
}

const mockPool = {
  query: vi.fn(smartQuery),
  connect: vi.fn().mockResolvedValue({
    query: vi.fn(smartQuery),
    release: vi.fn(),
  }),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// ─── Mock 8 个 plugin（KEY assertion 目标） ─────────────────────────────────
vi.mock('../../dept-heartbeat.js', () => ({
  tick: vi.fn().mockResolvedValue({ triggered: 0, skipped: 0, results: [] }),
}));
vi.mock('../../kr-progress-sync-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ actions: [] }),
}));
vi.mock('../../heartbeat-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ actions: [] }),
}));
vi.mock('../../goal-eval-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ actions: [] }),
}));
vi.mock('../../pipeline-patrol-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ scanned: 0 }),
}));
vi.mock('../../pipeline-watchdog-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ scanned: 0 }),
}));
vi.mock('../../kr-health-daily-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ action: null, summary: null, issues_count: 0 }),
}));
vi.mock('../../cleanup-worker-plugin.js', () => ({
  tick: vi.fn().mockResolvedValue({ removed: 0 }),
}));

// ─── Mock dispatcher（行动层入口） ──────────────────────────────────────────
vi.mock('../../dispatcher.js', () => ({
  dispatchNextTask: vi.fn().mockResolvedValue({
    dispatched: false,
    reason: 'no_dispatchable_task',
    actions: [],
  }),
}));

// ─── Mock alertness（hot path，影响 tick 走向） ─────────────────────────────
vi.mock('../../alertness/index.js', () => ({
  evaluateAlertness: vi.fn().mockResolvedValue({
    level: 1,
    levelName: 'CALM',
    score: 0.5,
  }),
  canDispatch: vi.fn().mockReturnValue(true),
  canPlan: vi.fn().mockReturnValue(true),
  getDispatchRate: vi.fn().mockReturnValue(1.0),
  ALERTNESS_LEVELS: { SLEEPING: 0, CALM: 1, AWARE: 2, ALERT: 3, PANIC: 4 },
  LEVEL_NAMES: ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'],
}));
vi.mock('../../alertness/healing.js', () => ({
  getRecoveryStatus: vi.fn().mockReturnValue({ active: false, dispatch_cap: 1.0 }),
}));
vi.mock('../../alertness/metrics.js', () => ({
  recordTickTime: vi.fn(),
  recordOperation: vi.fn(),
}));

// ─── Mock executor / focus / planner / decision 等行动层依赖 ─────────────
vi.mock('../../executor.js', () => ({
  // checkServerResources 被读 .metrics.max_pressure，必须带 metrics
  checkServerResources: vi.fn().mockReturnValue({
    cpu_percent: 10,
    mem_percent: 30,
    free_mem_mb: 4096,
    ok: true,
    metrics: { max_pressure: 0.3, cpu: 0.1, mem: 0.3, swap: 0 },
  }),
  // probeTaskLiveness 被 spread → 必须返数组
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  killProcessTwoStage: vi.fn().mockResolvedValue({ killed: false }),
  requeueTask: vi.fn().mockResolvedValue({ reason: 'requeued' }),
  getBillingPause: vi.fn().mockReturnValue({ paused: false }),
  MAX_SEATS: 4,
  INTERACTIVE_RESERVE: 1,
}));
vi.mock('../../slot-allocator.js', () => ({
  // tick 读 budget.taskPool.available + budget.user.mode — 必须返完整结构
  calculateSlotBudget: vi.fn().mockResolvedValue({
    taskPool: { available: 1, reserved: 0, total: 4, max: 4 },
    interactive: { available: 1, reserved: 0, total: 1 },
    user: { mode: 'absent', reserved_for_user: 0 },
    stats: { active_tasks: 0, in_progress: 0 },
  }),
}));
vi.mock('../../focus.js', () => ({
  // tick-runner 用 !!focusResult 判 hasFocus，再访问 focus.objective.id —— 返 null 走全局 fallback
  getDailyFocus: vi.fn().mockResolvedValue(null),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getReadyKRs: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../planner.js', () => ({
  planNextTask: vi.fn().mockResolvedValue({ planned: false, reason: 'no_active_kr' }),
  checkPrPlansCompletion: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn().mockReturnValue([]),
  generateDecision: vi.fn().mockResolvedValue(null),
  executeDecision: vi.fn().mockResolvedValue({ success: true }),
  splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], risky: [] }),
}));
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue({
    actions_executed: [],
    actions_failed: [],
  }),
  expireStaleProposals: vi.fn().mockResolvedValue(0),
}));

// ─── Mock thalamus / event-bus ─────────────────────────────────────────────
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({
    level: 'L1',
    actions: [{ type: 'fallback_to_tick' }],
  }),
  EVENT_TYPES: { TICK: 'tick' },
}));
vi.mock('../../event-bus.js', () => ({ emit: vi.fn() }));

// ─── Mock quarantine / health-monitor ──────────────────────────────────────
vi.mock('../../quarantine.js', () => ({
  // tick 用 for ... of released —— 必须返数组
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../health-monitor.js', () => ({
  runLayer2HealthCheck: vi.fn().mockResolvedValue({
    summary: 'health ok',
    healthy: true,
  }),
}));

// ─── Mock 后台 scheduler / digest / report 等（fire-and-forget 类） ────────
vi.mock('../../daily-review-scheduler.js', () => ({
  triggerDailyReview: vi.fn().mockResolvedValue({ triggered: 0, skipped: 0 }),
  triggerContractScan: vi.fn().mockResolvedValue(undefined),
  triggerArchReview: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: vi.fn() }));
vi.mock('../../conversation-digest.js', () => ({ runConversationDigest: vi.fn() }));
vi.mock('../../capture-digestion.js', () => ({ runCaptureDigestion: vi.fn() }));
vi.mock('../../topic-selection-scheduler.js', () => ({ triggerDailyTopicSelection: vi.fn() }));
vi.mock('../../topic-suggestion-manager.js', () => ({ autoPromoteSuggestions: vi.fn() }));
vi.mock('../../daily-publish-scheduler.js', () => ({ triggerDailyPublish: vi.fn() }));
vi.mock('../../daily-report-generator.js', () => ({ generateDailyReport: vi.fn() }));
vi.mock('../../weekly-report-generator.js', () => ({ generateWeeklyReport: vi.fn() }));
vi.mock('../../publish-monitor.js', () => ({ monitorPublishQueue: vi.fn() }));
vi.mock('../../post-publish-data-collector.js', () => ({ schedulePostPublishCollection: vi.fn() }));
vi.mock('../../social-media-sync.js', () => ({ syncSocialMediaData: vi.fn() }));
vi.mock('../../desire/index.js', () => ({ runDesireSystem: vi.fn() }));
vi.mock('../../rumination.js', () => ({ runRumination: vi.fn().mockResolvedValue(null) }));
vi.mock('../../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn() }));
vi.mock('../../suggestion-cycle.js', () => ({ runSuggestionCycle: vi.fn() }));
vi.mock('../../conversation-consolidator.js', () => ({ runConversationConsolidator: vi.fn() }));
vi.mock('../../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn() }));
vi.mock('../../events/taskEvents.js', () => ({
  publishCognitiveState: vi.fn(),
  publishTickExecuted: vi.fn(),
}));
vi.mock('../../cognitive-core.js', () => ({
  evaluateEmotion: vi.fn().mockReturnValue({
    label: '平静',
    state: 'calm',
    dispatch_rate_modifier: 1.0,
  }),
  getCurrentEmotion: vi.fn().mockReturnValue({ label: '平静', state: 'calm' }),
  updateSubjectiveTime: vi.fn(),
  getSubjectiveTime: vi.fn().mockReturnValue({ pace: 'normal' }),
  updateNarrative: vi.fn().mockResolvedValue(undefined),
  recordTickEvent: vi.fn(),
}));
vi.mock('../../self-report-collector.js', () => ({ collectSelfReport: vi.fn() }));
vi.mock('../../consolidation.js', () => ({ runDailyConsolidationIfNeeded: vi.fn() }));
vi.mock('../../alerting.js', () => ({ flushAlertsIfNeeded: vi.fn() }));
vi.mock('../../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn(),
  synthesizeEvolutionIfNeeded: vi.fn(),
}));
vi.mock('../../task-generator-scheduler.js', () => ({ triggerCodeQualityScan: vi.fn() }));
vi.mock('../../zombie-sweep.js', () => ({
  zombieSweep: vi.fn().mockResolvedValue({
    worktrees: { removed: 0 },
    processes: { killed: 0 },
    lock_slots: { removed: 0 },
  }),
}));
vi.mock('../../memory-sync.js', () => ({ memorySyncIfNeeded: vi.fn() }));
vi.mock('../../daily-scrape-scheduler.js', () => ({ scheduleDailyScrape: vi.fn() }));
vi.mock('../../kr3-progress-scheduler.js', () => ({ scheduleKR3ProgressReport: vi.fn() }));
vi.mock('../../credential-expiry-checker.js', () => ({
  checkAndAlertExpiringCredentials: vi.fn().mockResolvedValue({ alerted: 0 }),
  recoverAuthQuarantinedTasks: vi.fn().mockResolvedValue({ recovered: 0 }),
  scanAuthLayerHealth: vi.fn().mockResolvedValue({ alerted: 0 }),
  cleanupDuplicateRescueTasks: vi.fn().mockResolvedValue({ cancelled: 0, branches: 0 }),
  cancelCredentialAlertTasks: vi.fn().mockResolvedValue({ cancelled: 0 }),
}));
vi.mock('../../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn().mockReturnValue(false), // 跳过 LLM 后台路径
  reloadConsciousnessCache: vi.fn(),
}));
vi.mock('../../report-48h.js', () => ({
  check48hReport: vi.fn().mockResolvedValue(false),
  generate48hReport: vi.fn(),
  REPORT_INTERVAL_MS: 48 * 60 * 60 * 1000,
}));
vi.mock('../../tick-helpers.js', () => ({
  releaseBlockedTasks: vi.fn().mockResolvedValue([]),
  // tick-runner 用 actionsTaken.push(...timeoutActions) 直接 spread，必须返数组
  autoFailTimedOutTasks: vi.fn().mockResolvedValue([]),
  getRampedDispatchMax: vi.fn().mockReturnValue(1),
}));

// ─── 动态 import（避免 mock 注册之前 import）────────────────────────────────
import { tickState, resetTickStateForTests } from '../../tick-state.js';

describe('tick-runner executeTick — full tick wire-up', () => {
  beforeEach(() => {
    // tickState 是单例 — 每次测试前重置，避免 last*Time 干扰节流判断
    resetTickStateForTests();
    vi.clearAllMocks();
  });

  it('一次 executeTick：8 个 plugin .tick 都被调；dispatcher 被调；tickState 时间戳前移', async () => {
    const before = Date.now() - 1; // 防同毫秒赋值导致 ">" 比较失败

    // 重新 import 各 mock 拿到 spy reference
    const dept = await import('../../dept-heartbeat.js');
    const krProgress = await import('../../kr-progress-sync-plugin.js');
    const heartbeat = await import('../../heartbeat-plugin.js');
    const goalEval = await import('../../goal-eval-plugin.js');
    const patrol = await import('../../pipeline-patrol-plugin.js');
    const watchdog = await import('../../pipeline-watchdog-plugin.js');
    const krHealth = await import('../../kr-health-daily-plugin.js');
    const cleanup = await import('../../cleanup-worker-plugin.js');
    const dispatcher = await import('../../dispatcher.js');

    const { executeTick } = await import('../../tick-runner.js');

    const result = await executeTick();

    // executeTick 返回 truthy 结果（success 或带 reason 的 panic skip）
    expect(result).toBeDefined();
    expect(result.success).toBe(true);

    // ── 8 个 plugin .tick 必须全被调 ─────────────────────────────────────
    expect(dept.tick).toHaveBeenCalled();
    expect(krProgress.tick).toHaveBeenCalled();
    expect(heartbeat.tick).toHaveBeenCalled();
    expect(goalEval.tick).toHaveBeenCalled();
    expect(patrol.tick).toHaveBeenCalled();
    expect(watchdog.tick).toHaveBeenCalled();
    expect(krHealth.tick).toHaveBeenCalled();
    expect(cleanup.tick).toHaveBeenCalled();

    // ── dispatcher 被调（行动层入口） ────────────────────────────────────
    expect(dispatcher.dispatchNextTask).toHaveBeenCalled();

    // ── tickState 感知层时间戳被推进（lastZombieSweepTime 是首个无条件推进字段）
    expect(tickState.lastZombieSweepTime).toBeGreaterThan(before);
  }, 30000);
});
