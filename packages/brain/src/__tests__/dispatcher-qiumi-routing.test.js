/**
 * dispatcher-qiumi-routing.test.js
 *
 * 秋米任务路由 PR3 · Task 4：dispatcher 对 qiumi_task 的专用出口（接线点见 plan 补充四）。
 *
 * 接线点必须在原子 claim 之后、标 in_progress 之前。审查发现的 Critical 就在这里：
 * 放到标 in_progress 之后，任务状态已不是 queued，于是
 *   · persistDecision 的 device/fail 两条分支带 `AND status='queued'` CAS → 0 行，
 *     设备没转、失败没落、claim 没放，dispatcher 却照样报 routed/failed（账实分叉）；
 *   · 并发闸 count(in_progress) 把自己数进去，上限 2 实际只剩 1；
 *   · 闸满/spawn 失败只放 claim 不退 status → 任务永久卡 in_progress 占着闸。
 *
 * 所以 dispatchQiumiTask 返回三态，自己不 spawn、不改 status 为 in_progress：
 *   return  —— device / fail / P0 闸满：已落库或已放 claim，result 带累计 actions
 *   skip    —— 非 P0 闸满：已放 claim、已进 holSkipIds，交回候选循环换下一个
 *   proceed —— agent 决策已落库，回主流程标 in_progress → 读全行 → triggerCeceliaRun
 *
 * 变异清单：
 *   删并发闸 `>=` 判断            → 闸用例红
 *   把接线点挪回 taskToDispatch 之后 → 「接线点在标 in_progress 之前」两条用例红
 *   agent 分支在函数内 spawn       → proceed 用例红
 *   qiumi_task 去掉锚点豁免        → 锚点用例红
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

let _candidatePool = [];
const mockSelectNextDispatchableTask = vi.fn(async (goalIds, excludeIds = []) => (
  _candidatePool.find((c) => !excludeIds.includes(c.id)) || null
));
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(async () => ({ dispatched: false })),
}));

vi.mock('../alertness-actions.js', () => ({ getMitigationState: () => ({ drain_mode_requested: false }) }));
vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false, getQuotaCoolingState: () => ({ until: null }) }));
vi.mock('../drain.js', () => ({ isDraining: () => false, getDrainStartedAt: () => null }));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok' }),
  calculateSlotBudget: async () => ({
    dispatchAllowed: true, taskPool: { budget: 10 }, user: { mode: 'solo' },
    codex: { available: true, running: 0, max: 5 }, budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: () => false,
}));
vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: () => false }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
const mockIsAllowed = vi.fn(() => true);
const mockRecordFailure = vi.fn(async () => {});
const mockRecordSuccess = vi.fn(async () => {});
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (k) => mockIsAllowed(k),
  recordFailure: (...a) => mockRecordFailure(...a),
  recordSuccess: (...a) => mockRecordSuccess(...a),
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

import { routeQiumiTask, persistDecision } from '../routing/qiumi-router.js';
import { recordDispatchResult } from '../dispatch-stats.js';
import { checkAnchor } from '../anchor-check.js';
import { checkCeceliaRunAvailable } from '../executor.js';
import { dispatchQiumiTask, dispatchNextTask } from '../dispatcher.js';

// 候选行（选单 SQL 只取部分列，payload 未必带全）
const candidate = { id: 'q1', task_type: 'qiumi_task', status: 'queued', priority: 'P2', title: '给张三发个私信确认收货地址', created_at: new Date().toISOString() };
// 库里的整行
const fullRow = { ...candidate, payload: { qiumi_source: { title: '给张三发个私信确认收货地址' } } };

/** 按 SQL 形状回答，不靠调用次序——dispatchNextTask 前面还有若干条真查询 */
function wireQueries({ running = 0, claimed = true } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return { rows: claimed ? [{ id: 'q1' }] : [] };
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [fullRow] };
    if (/count\(\*\)::int AS n FROM tasks/.test(sql) && /openclaw-agent/.test(sql)) return { rows: [{ n: running }] };
    return { rows: [] };
  });
}

const sqlsOf = () => mockQuery.mock.calls.map(([sql]) => sql);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  _candidatePool = [];
  mockUpdateTask.mockResolvedValue({ success: true });
  mockTriggerCeceliaRun.mockResolvedValue({ success: true, runId: 'r' });
  mockIsAllowed.mockImplementation(() => true);
});

describe('dispatchQiumiTask：三态出口', () => {
  it('先读全行再路由：传给 routeQiumiTask 的 task 带 payload，且状态仍是 queued', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'device_uncertain', detail: 'p=0.6' });

    await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    const routed = routeQiumiTask.mock.calls[0][0];
    expect(routed.payload, '路由拿到的是候选行不是库里整行——便宜闸读不到 qiumi_source').toBeTruthy();
    expect(
      routed.status,
      '进路由时任务已不是 queued——persistDecision 的 CAS 会全部落空',
    ).toBe('queued');
  });

  // 候选循环不在 postClaimException 的覆盖范围内（对照锚点闸分支的注释）：这里抛出去
  // = claim 永远挂着，那条任务再也起不来，整轮派发也跟着断。
  it('路由抛异常 → outcome=skip，释放 claim + 记 qiumi_route_exception，不把异常往外抛', async () => {
    wireQueries();
    routeQiumiTask.mockRejectedValue(new Error('loadRegistryPool boom'));

    const r = await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    expect(r).toMatchObject({ outcome: 'skip' });
    expect(sqlsOf().some((s) => /UPDATE tasks SET claimed_by = NULL/.test(s)), 'claim 泄漏：这条任务再也起不来').toBe(true);
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'qiumi_route_exception', undefined, 'q1');
  });

  it('落库抛异常（persistDecision）同样被兜住，不往外抛', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', engine: 'terra', payloadPatch: {} });
    persistDecision.mockRejectedValueOnce(new Error('db down'));

    await expect(dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] }))
      .resolves.toMatchObject({ outcome: 'skip' });
  });

  it('并发闸只数 qiumi_task：别的类型挂同一 executor_kind 不该占闸位（收割器也不认它）', async () => {
    wireQueries({ running: 0 });
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'x', detail: 'y' });
    await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });
    const gate = sqlsOf().find((s) => /count\(\*\)::int AS n FROM tasks/.test(s));
    expect(gate).toMatch(/task_type = 'qiumi_task'/);
  });

  it('并发闸：非 P0 闸满 → outcome=skip，释放 claim、进 holSkipIds，不路由', async () => {
    wireQueries({ running: 2 });
    const holSkipIds = [];

    const r = await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds });

    expect(r).toMatchObject({ outcome: 'skip' });
    expect(routeQiumiTask, '闸满还去问 Jev——白烧一次路由').not.toHaveBeenCalled();
    expect(holSkipIds).toContain('q1');
    expect(sqlsOf().some((s) => /claimed_by = NULL/.test(s))).toBe(true);
  });

  it('并发闸：P0 闸满 → outcome=return，reason=openclaw_agent_pool_full，带累计 actions', async () => {
    wireQueries({ running: 3 });
    const actions = [{ action: 'earlier-action' }];

    const r = await dispatchQiumiTask({ ...candidate, priority: 'P0' }, { env: { mmvConcurrency: 2 }, actions, holSkipIds: [] });

    expect(r.outcome).toBe('return');
    expect(r.result).toMatchObject({ dispatched: false, reason: 'openclaw_agent_pool_full', task_id: 'q1' });
    expect(r.result.actions, '返回体丢了此前累计的 actions').toEqual(expect.arrayContaining([{ action: 'earlier-action' }]));
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'openclaw_agent_pool_full', undefined, 'q1');
  });

  it('并发闸只数 in_progress 的 openclaw-agent，且不把自己标 in_progress', async () => {
    wireQueries({ running: 0 });
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });

    await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    const countSql = sqlsOf().find((s) => /count\(\*\)::int AS n FROM tasks/.test(s));
    expect(countSql).toMatch(/executor_kind\s*=\s*'openclaw-agent'/);
    expect(countSql).toMatch(/status\s*=\s*'in_progress'/);
    expect(
      sqlsOf().some((s) => /status\s*=\s*'in_progress'/.test(s) && /^\s*UPDATE/i.test(s.trim())),
      'dispatchQiumiTask 自己把任务标成了 in_progress——闸会把自己数进去，CAS 也会落空',
    ).toBe(false);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it('device 决策 → outcome=return，persistDecision 落库，不 spawn', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'device', serial: 'S1', workflowRef: 'wf-1', payloadPatch: {} });

    const r = await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('return');
    expect(r.result).toMatchObject({ dispatched: false, reason: 'qiumi_routed_device', task_id: 'q1' });
    // 补充五之后不再"转换"父任务，而是派生子任务——action 名跟着语义改
    expect(r.result.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'qiumi-device-delegated', task_id: 'q1', serial: 'S1' }),
    ]));
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'device' }));
    expect(mockTriggerCeceliaRun, 'device 决策还去 spawn——同一件活手机和 agent 会各做一遍').not.toHaveBeenCalled();
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'qiumi_routed_device', undefined, 'q1');
  });

  it('fail 决策 → outcome=return，reason=qiumi_route_failed，不 spawn', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'device_uncertain', detail: 'conf=0.6' });

    const r = await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('return');
    expect(r.result).toMatchObject({ dispatched: false, reason: 'qiumi_route_failed', task_id: 'q1' });
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'fail' }));
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'qiumi_route_failed', undefined, 'q1');
  });

  it('agent 决策 → outcome=proceed：决策已落库，spawn 交回主流程（函数内不 spawn）', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({
      outcome: 'agent', engine: 'claude', model: 'claude-cli/claude-sonnet-5',
      runId: 'qiumi-q1-1', payloadPatch: { model: 'claude-cli/claude-sonnet-5', run_id: 'qiumi-q1-1' },
    });

    const r = await dispatchQiumiTask(candidate, { env: { mmvConcurrency: 2 }, actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'agent' }));
    expect(
      mockTriggerCeceliaRun,
      'agent 分支在函数内 spawn 了——此时任务还没标 in_progress，主流程的回滚也管不到它',
    ).not.toHaveBeenCalled();
  });
});

describe('dispatchNextTask：接线点在 claim 之后、标 in_progress 之前', () => {
  it('device 决策：全程没把任务标成 in_progress，直接返回 qiumi_routed_device', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'device', serial: 'S1', payloadPatch: {} });

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: false, reason: 'qiumi_routed_device', task_id: 'q1' });
    expect(
      mockUpdateTask,
      '任务被标了 in_progress——persistDecision 的 `AND status=queued` CAS 会 0 行，设备根本没转过去',
    ).not.toHaveBeenCalled();
  });

  it('agent 决策：路由发生在 updateTask(in_progress) 之前（调用序守卫）', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    mockUpdateTask.mockResolvedValue({ success: false }); // 标 in_progress 失败 → 主流程就地返回，用例到此为止

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: false, reason: 'update_failed', task_id: 'q1' });
    expect(mockUpdateTask).toHaveBeenCalledWith({ task_id: 'q1', status: 'in_progress' });
    expect(
      routeQiumiTask.mock.invocationCallOrder[0],
      '路由发生在标 in_progress 之后——接线点又掉回 taskToDispatch 那一段了',
    ).toBeLessThan(mockUpdateTask.mock.invocationCallOrder[0]);
  });

  it('claim 没抢到 → 不路由（省掉一次 Jev 调用）', async () => {
    _candidatePool = [candidate];
    wireQueries({ claimed: false });

    const r = await dispatchNextTask(null);

    expect(r).toMatchObject({ dispatched: false, reason: 'already_claimed' });
    expect(routeQiumiTask).not.toHaveBeenCalled();
  });
});

describe('锚点闸：qiumi_task 免锚（第二道闸放开后的连带项）', () => {
  it('新建的 qiumi_task 没有 payload.anchor 也不被锚点闸拦', () => {
    const r = checkAnchor({ task_type: 'qiumi_task', payload: {}, created_at: new Date().toISOString() });
    expect(
      r.blocked,
      'qiumi_task 不免锚——入账链从不写 payload.anchor，每条秋米任务都会在路由之前被终态 failed',
    ).toBe(false);
  });
});

describe('接线点静态守卫', () => {
  it('分支在原子 claim 之后、候选期分配指南之前，且不在标 in_progress 之后那一段', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dispatcher.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    const claimIdx = src.indexOf('UPDATE tasks SET claimed_by = $1, claimed_at = NOW()');
    const hookIdx = src.indexOf("candidate.task_type === 'qiumi_task'");
    const guideIdx = src.indexOf('applyDispatchAllocationGuide(candidate');
    const inProgressIdx = src.indexOf("status: 'in_progress'");

    expect(hookIdx, '候选循环里没有 qiumi_task 的接线点').toBeGreaterThan(-1);
    expect(hookIdx, '接线点在原子 claim 之前——没拿到独占权就开始路由').toBeGreaterThan(claimIdx);
    expect(hookIdx, '接线点在候选期分配指南之后').toBeLessThan(guideIdx);
    expect(hookIdx, '接线点在标 in_progress 之后——本次审查 Critical 的原样复发').toBeLessThan(inProgressIdx);
    expect(
      src.indexOf("taskToDispatch.task_type === 'qiumi_task'"),
      '标 in_progress 之后那一段还留着 qiumi 分支',
    ).toBe(-1);
  });
});
