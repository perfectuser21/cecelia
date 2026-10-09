/**
 * dispatcher-qiumi-pool-gate-bypass.test.js
 *
 * Brain 任务 6e63bedf：任务池总闸关着（pool_exhausted / pool_c_full）时，Notion 来的
 * qiumi_task 白白排队数小时。
 *
 * 根因：dispatchNextTask 的槽位总闸 `!slotBudget.dispatchAllowed` 复查仍不通过且无 xian 旁路时
 * 整轮 return；而 qiumi_task 的专用出口 dispatchQiumiTask 在后面的候选循环里，根本走不到。
 * 但 qiumi_task 穿透 MMV 的 OpenClaw 网关执行，不占 fleet 槽位，自带 MMV 并发上限
 * (env.mmvConcurrency) 与同机串行闸，不该被 fleet 槽位拦住。
 *
 * 修复语义：总闸关着且无 xian 旁路 → 先探测队列里有没有 qiumi_task 候选；有 → 置
 * qiumiOnlyBypass，继续往下走，且候选循环只选 qiumi_task（onlyTaskTypes:['qiumi_task']，
 * 绝不顺带放行普通任务）；没有 → 原拦截逻辑（pool_* 原因）完全不变。
 * resourceAdmissionBlocked（资源数据不可信）早退保持不变——秋米也不派。
 * 总闸开着时选单不带 onlyTaskTypes，行为与改动前一致。
 *
 * 变异清单：
 *   探测改成恒 false                        → 用例 1、2 红
 *   旁路放行后候选循环不限定 qiumi_task      → 用例 2 红（普通任务 d1 被派发）
 *   总闸开着时也传 onlyTaskTypes             → 用例 5 红
 *   旁路放到 resourceAdmissionBlocked 之前   → 用例 4 红
 *   探测不到时也放行（去掉探测）              → 用例 3 红
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

vi.mock('../routing/qiumi-router.js', () => ({
  routeQiumiTask: vi.fn(),
  persistDecision: vi.fn().mockResolvedValue(undefined),
}));

const mockTriggerCeceliaRun = vi.fn(async () => ({ success: true, runId: 'r' }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  killProcessTwoStage: vi.fn(async () => ({ killed: false })),
  getBillingPause: () => ({ active: false }),
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
  DISPATCH_STATS_KEY: 'dispatch_stats',
}));

const mockUpdateTask = vi.fn(async () => ({ success: true }));
vi.mock('../actions.js', () => ({ updateTask: (...args) => mockUpdateTask(...args) }));

// 候选池按队列顺序；选单必须尊重 options.onlyTaskTypes（与真实 SQL 的限定等价）
let _candidatePool = [];
const mockSelectNextDispatchableTask = vi.fn(async (goalIds, excludeIds = [], options = {}) => {
  const only = options?.onlyTaskTypes;
  return _candidatePool.find((c) => (
    !excludeIds.includes(c.id) && (!Array.isArray(only) || only.length === 0 || only.includes(c.task_type))
  )) || null;
});
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(async () => ({ dispatched: false })),
}));

vi.mock('../alertness-actions.js', () => ({ getMitigationState: () => ({ drain_mode_requested: false }) }));
vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false, getQuotaCoolingState: () => ({ until: null }) }));
vi.mock('../drain.js', () => ({ isDraining: () => false, getDrainStartedAt: () => null }));

// 默认总闸关着：池满（budget 4 / used 4）
const closedBudget = () => ({
  dispatchAllowed: false,
  resourceAdmissionBlocked: false,
  taskPool: { budget: 4, used: 4, available: 0 },
  user: { mode: 'solo' },
  codex: { available: false, running: 0, max: 0 },
  budgetState: { state: 'abundant' },
});
let _budget = closedBudget();
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok' }),
  calculateSlotBudget: async () => _budget,
  shouldBypassBackpressure: () => false,
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: () => false }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: () => true,
  recordFailure: vi.fn(async () => {}),
  recordSuccess: vi.fn(async () => {}),
}));
vi.mock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ incrementActionsToday: vi.fn(async () => {}) }));
vi.mock('../account-usage.js', () => ({ proactiveTokenCheck: vi.fn(async () => {}) }));
vi.mock('../quota-guard.js', () => ({ checkQuotaGuard: async () => ({ allow: true, priorityFilter: null, bestPct: 10 }) }));
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: async () => ({ passed: true, issues: [], suggestions: [] }),
  alertOnPreFlightFail: vi.fn(async () => {}),
  getPreFlightStats: async () => ({}),
  PRE_FLIGHT_ALERT_THRESHOLD: 3,
}));
vi.mock('../dispatch-dedup.js', () => ({ findDuplicateSibling: vi.fn(async () => null) }));

import { routeQiumiTask } from '../routing/qiumi-router.js';
import { buildQiumiSource } from '../lib/qiumi-source.js';
import { dispatchNextTask } from '../dispatcher.js';

const now = new Date().toISOString();
const qiumi = { id: 'q1', task_type: 'qiumi_task', status: 'queued', priority: 'P2', title: '给张三发个私信确认收货地址', created_at: now };
const normal = { id: 'd1', task_type: 'data', status: 'queued', priority: 'P0', title: '普通数据任务', created_at: now };
const fullRow = { ...qiumi, payload: { qiumi_source: buildQiumiSource({ title: qiumi.title }) } };

/** 按 SQL 形状回答，不靠调用次序 */
function wireQueries() {
  mockQuery.mockImplementation(async (sql) => {
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return { rows: [{ id: 'q1' }] };
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [fullRow] };
    if (/count\(\*\)::int AS n FROM tasks/.test(sql) && /openclaw-agent/.test(sql)) return { rows: [{ n: 0 }] };
    return { rows: [] };
  });
}

const selectOptions = () => mockSelectNextDispatchableTask.mock.calls.map(([, , options]) => options);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  _candidatePool = [];
  _budget = closedBudget();
  wireQueries();
  // 让流程在「标 in_progress」处就地返回，用例到此为止
  mockUpdateTask.mockResolvedValue({ success: false });
  routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
});

describe('任务池总闸关着：秋米任务旁路放行（任务 6e63bedf）', () => {
  it('1. 总闸关着、队列里有 qiumi_task → 不以 pool_ 拦截，路由 1 次，标 in_progress', async () => {
    _candidatePool = [qiumi];

    const r = await dispatchNextTask(null);

    expect(r.reason, '总闸关着就把秋米任务一并拦了——它穿透 MMV 不占 fleet 槽位').not.toMatch(/^pool_/);
    expect(routeQiumiTask).toHaveBeenCalledTimes(1);
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: 'q1', status: 'in_progress' });
  });

  it('2. 总闸关着、候选池 [普通 P0 d1, qiumi q1] → 只派 q1，普通任务不被顺带放行；选单全程限定 qiumi_task', async () => {
    _candidatePool = [normal, qiumi];

    await dispatchNextTask(null);

    expect(mockUpdateTask, '普通任务借秋米旁路溜过了总闸').not.toHaveBeenCalledWith(expect.objectContaining({ task_id: 'd1' }));
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: 'q1', status: 'in_progress' });
    const opts = selectOptions();
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o?.onlyTaskTypes, '旁路期间有选单没限定 qiumi_task').toEqual(['qiumi_task']);
    }
  });

  it('3. 总闸关着、队列里只有普通任务 → 原拦截不变：pool_* 原因，不路由不更新', async () => {
    _candidatePool = [normal];

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: false });
    expect(r.reason).toMatch(/^pool_/);
    expect(routeQiumiTask).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('4. 总闸关着且 resourceAdmissionBlocked → resource_unavailable 早退，秋米也不派', async () => {
    _budget = { ..._budget, resourceAdmissionBlocked: true };
    _candidatePool = [qiumi];

    const r = await dispatchNextTask(null);

    expect(r.reason).toBe('resource_unavailable');
    expect(routeQiumiTask).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('5. 总闸开着 → 所有选单调用不带 onlyTaskTypes（行为与改动前一致）', async () => {
    _budget = { ..._budget, dispatchAllowed: true, taskPool: { budget: 10, used: 0, available: 10 } };
    _candidatePool = [normal, qiumi];

    await dispatchNextTask(null);

    const opts = selectOptions();
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o?.onlyTaskTypes ?? null, '总闸开着也限定了任务类型——普通任务全被饿死').toBeNull();
    }
  });
});
