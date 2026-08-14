/**
 * dispatcher-hol-skip.test.js
 *
 * Regression test for Notion issue 0014cd42 — no_executor 队头阻塞（HOL）+ 静默失败。
 *
 * Root cause: dispatchNextTask() 在候选 claim 成功后才查 checkCeceliaRunAvailable()，
 * bridge 不可用时 revert + 释放 claim 后直接 return {reason:'no_executor'}，不试下一个
 * 候选。结果：队头一个需要 bridge 的任务（dev / harness_intervention）反复占位，
 * 不需要 bridge 的 harness_initiative（豁免 bridge check）被堵死 13 小时。
 * 且 no_executor 只写 working_memory / decision_log，无 console 日志，完全静默。
 *
 * 修复语义：
 * - no_executor → revert + 释放 claim + 记入跳过列表 → 回到候选选择循环选下一个
 * - 跳过次数上限 MAX_SKIP_HEAD_FOR_BLOCKED（10），防无限循环
 * - 全部候选都 no_executor 时最终 return no_executor（与旧行为一致）
 * - 每次跳过 tickLog 一行含 "no_executor"（可观测）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalRoutingReceipt, routedCodingPayload } from './helpers/routing-receipt-fixture.js';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) }
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));
vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));

const mockCheckAvailable = vi.fn();
const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckAvailable(...args),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));
vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 5 },
    budgetState: { state: 'abundant' },
  }),
  harnessSlotCheck: vi.fn().mockResolvedValue({
    allow: true,
    reason: null,
    containers: 0,
    inflight: 0,
    cap: { effective: 4, mem_cap: 4, acct_cap: 4, hard_cap: 4 },
    stale: false,
  }),
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true })
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true })
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

const mockSelectNextDispatchableTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(),
}));
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({}),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

// ─── 候选任务 fixture ───────────────────────────────────────────────────────
const DEV_TASK = {
  id: '11111111-0000-0000-0000-000000000001',
  task_type: 'dev',
  project_id: null,
  priority: 'P1',
  title: 'dev task that needs cecelia-bridge',
  payload: {},
  created_at: '2026-07-16T00:00:00Z',
};
const HARNESS_TASK = {
  id: '22222222-0000-0000-0000-000000000002',
  task_type: 'harness_initiative',
  project_id: null,
  priority: 'P1',
  title: 'harness_initiative that does NOT need bridge',
  payload: routedCodingPayload('22222222-0000-0000-0000-000000000002', { sprint_dir: 'sprints/test', base_repo: '/repo' }),
};

/** 生成 N 个都需要 bridge 的 dev 候选 */
function makeDevCandidates(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `dddddddd-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    task_type: 'dev',
    project_id: null,
    priority: 'P1',
    title: `dev candidate ${i + 1}`,
    payload: {},
    created_at: '2026-07-16T00:00:00Z',
  }));
}

describe('dispatchNextTask — no_executor HOL skip (issue 0014cd42)', () => {
  let releasedClaimIds;
  let candidates;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockCheckAvailable.mockReset();
    mockTriggerCeceliaRun.mockReset();

    releasedClaimIds = [];
    candidates = [];

    // 候选选择遵守 skipIds（与真实 selectNextDispatchableTask 的语义一致）
    mockSelectNextDispatchableTask.mockImplementation(async (_goalIds, skipIds = []) => {
      return candidates.find((c) => !skipIds.includes(c.id)) ?? null;
    });

    // 默认 DB mock：claim 总是成功；释放 claim 记账；full-task fetch 返回对应候选行
    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: params[1] }] });
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaimIds.push(params[0]);
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT count\(\*\)::int AS n FROM tasks/.test(sql)) {
        return Promise.resolve({ rows: [{ n: 0 }] }); // harness 并发计数 0 < cap
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        const row = candidates.find((c) => c.id === params[0]);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (/FROM work_routing_receipts receipt/.test(sql)) {
        return Promise.resolve({ rows: [canonicalRoutingReceipt(HARNESS_TASK)] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    // bridge 掉线（今天的实际故障）
    mockCheckAvailable.mockResolvedValue({ available: false, error: 'Bridge not running (ECONNREFUSED :3457)' });
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 12345, runId: 'run-hol-1' });
  });

  it('用例 A（复现 bug）：队头 dev 任务 no_executor → 跳过，第二个 harness_initiative 被派发', async () => {
    candidates = [DEV_TASK, HARNESS_TASK];

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // 修前：返回 { dispatched:false, reason:'no_executor' }，harness 候选永远轮不上
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(HARNESS_TASK.id);
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: HARNESS_TASK.id, task_type: 'harness_initiative' })
    );
    // dev 候选没有被派发
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: DEV_TASK.id })
    );
  });

  it('用例 B：被 no_executor 跳过的候选 claim 已释放 + status revert 回 queued', async () => {
    candidates = [DEV_TASK, HARNESS_TASK];

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
    // claimed_by=NULL 的 UPDATE 必须对被跳过的 dev 候选执行过
    expect(releasedClaimIds).toContain(DEV_TASK.id);
    // 且 status revert 回 queued（下一 tick 可重试）
    const { updateTask } = await import('../actions.js');
    expect(updateTask.mock.calls).toEqual(
      expect.arrayContaining([[{ task_id: DEV_TASK.id, status: 'queued' }]])
    );
    // 派发成功的 harness 候选的 claim 不能被释放
    expect(releasedClaimIds).not.toContain(HARNESS_TASK.id);
  });

  it('用例 C1：全部候选都需 bridge 且 bridge 挂 → 最终 return no_executor，每个候选 claim 都已释放', async () => {
    candidates = makeDevCandidates(2);

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_executor');
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    // 修前只 revert 队头一个；修后两个都试过、都释放了 claim
    expect(releasedClaimIds).toContain(candidates[0].id);
    expect(releasedClaimIds).toContain(candidates[1].id);
  });

  it('用例 C2：候选源源不断都 no_executor → 跳过次数不超上限（10），不无限循环', async () => {
    candidates = makeDevCandidates(15); // 超过 MAX_SKIP_HEAD_FOR_BLOCKED=10

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('no_executor');
    // 到达上限即放弃：bridge check 恰好做了 10 次，不是 15 次也不是无限
    expect(mockCheckAvailable).toHaveBeenCalledTimes(10);
  });

  it('用例 D：no_executor 跳过必须有 console 日志（不再静默）', async () => {
    candidates = [DEV_TASK, HARNESS_TASK];
    const logSpy = vi.spyOn(console, 'log');

    try {
      const { dispatchNextTask } = await import('../dispatcher.js');
      await dispatchNextTask([]);

      const logged = logSpy.mock.calls.some((args) => args.join(' ').includes('no_executor'));
      expect(logged).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
