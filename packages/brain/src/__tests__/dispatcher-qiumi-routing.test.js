// 原生秋米派发的claim、路由与资源准入回归；执行事实由原生运行器登记。
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

vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false, getQuotaCoolingState: () => ({ until: null }) }));
vi.mock('../drain.js', async (original) => ({ ...await original(), isDraining: () => false, getDrainStartedAt: () => null }));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok' }),
  calculateSlotBudget: async () => ({
    dispatchAllowed: true, taskPool: { budget: 10 }, user: { mode: 'solo' },
    codex: { available: true, running: 0, max: 5 }, budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: () => false,
}));
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

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: async () => ({ passed: true, issues: [], suggestions: [] }),
  alertOnPreFlightFail: vi.fn(async () => {}),
  getPreFlightStats: async () => ({}),
  PRE_FLIGHT_ALERT_THRESHOLD: 3,
}));
vi.mock('../dispatch-dedup.js', () => ({ findDuplicateSibling: vi.fn(async () => null) }));

import { routeQiumiTask, persistDecision } from '../routing/qiumi-router.js';
import { buildQiumiSource } from '../lib/qiumi-source.js';
import { recordDispatchResult } from '../dispatch-stats.js';
import { processCortexTask } from '../dispatch-helpers.js';
import { emit } from '../event-bus.js';
import { checkAnchor } from '../anchor-check.js';
import { checkCeceliaRunAvailable } from '../executor.js';
import { dispatchQiumiTask, dispatchNextTask } from '../dispatcher.js';

// 候选行（选单 SQL 只取部分列，payload 未必带全）
const candidate = { id: 'q1', task_type: 'qiumi_task', status: 'queued', priority: 'P2', title: '给张三发个私信确认收货地址', created_at: new Date().toISOString() };
// 库里的整行
const fullRow = { ...candidate, payload: { qiumi_source: buildQiumiSource({ title: '给张三发个私信确认收货地址' }) } };

/** 按 SQL 形状回答，不靠调用次序——dispatchNextTask 前面还有若干条真查询 */
function wireQueries({ claimed = true, row = fullRow } = {}) {
  mockQuery.mockImplementation(async (sql) => {
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return { rows: claimed ? [{ id: 'q1' }] : [] };
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [row] };
    return { rows: [] };
  });
}

const sqlsOf = () => mockQuery.mock.calls.map(([sql]) => sql);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  recordDispatchResult.mockReset().mockResolvedValue(undefined);
  routeQiumiTask.mockReset();
  persistDecision.mockReset().mockResolvedValue(undefined);
  _candidatePool = [];
  mockUpdateTask.mockResolvedValue({ success: true });
  mockTriggerCeceliaRun.mockResolvedValue({ success: true, runId: 'r' });
  mockIsAllowed.mockImplementation(() => true);
  checkCeceliaRunAvailable.mockResolvedValue({ available: true });
});

describe('dispatchQiumiTask：三态出口', () => {
  it('先读全行再路由：传给 routeQiumiTask 的 task 带 payload，且状态仍是 queued', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'device_uncertain', detail: 'p=0.6' });

    await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

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

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

    expect(r).toMatchObject({ outcome: 'skip' });
    expect(sqlsOf().some((s) => /UPDATE tasks SET claimed_by = NULL/.test(s)), 'claim 泄漏：这条任务再也起不来').toBe(true);
    expect(recordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'qiumi_route_exception', undefined, 'q1');
  });

  it('落库抛异常（persistDecision）同样被兜住，不往外抛', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', engine: 'terra', payloadPatch: {} });
    persistDecision.mockRejectedValueOnce(new Error('db down'));

    await expect(dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] }))
      .resolves.toMatchObject({ outcome: 'skip' });
  });

  it('fail 决策 → outcome=return，reason=device_uncertain，不 spawn', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'fail', reason: 'device_uncertain', detail: 'conf=0.6' });

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('return');
    expect(r.result).toMatchObject({ dispatched: false, reason: 'device_uncertain', task_id: 'q1' });
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'fail' }));
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();

  });

  it('unresolved 决策（手机定不下）→ outcome=return，reason=device_unresolved，persistDecision 落 blocked，不 spawn', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'unresolved', reason: 'device_unresolved', detail: { reason: 'no_match', candidates: [] }, note: 'n' });

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('return');
    expect(r.result).toMatchObject({ dispatched: false, reason: 'device_unresolved', task_id: 'q1' });
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'unresolved' }));
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();

  });

  it('agent 决策 → outcome=proceed：决策已落库，spawn 交回主流程（函数内不 spawn）', async () => {
    wireQueries();
    routeQiumiTask.mockResolvedValue({
      outcome: 'agent', model: 'fixture-model',
      payloadPatch: { qiumi_route: { source: 'native-agent' } },
    });

    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });

    expect(r.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'q1' }), expect.objectContaining({ outcome: 'agent' }));
    expect(
      mockTriggerCeceliaRun,
      'agent 分支在函数内 spawn 了——此时任务还没标 in_progress，主流程的回滚也管不到它',
    ).not.toHaveBeenCalled();
  });

});

describe('dispatchNextTask：接线点在 claim 之后、标 in_progress 之前', () => {

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

  it('claim 没抢到 → 不路由（未取得claim不能路由）', async () => {
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

describe('原生qiumi任务不受旧Bridge准入影响', () => {
  it('cecelia-run 熔断 OPEN 时 qiumi 仍走到 triggerCeceliaRun，且不查 bridge、不回滚 queued', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    mockIsAllowed.mockImplementation((k) => k !== 'cecelia-run');

    const r = await dispatchNextTask(null);

    expect(mockTriggerCeceliaRun, 'qiumi 被 cecelia-run 熔断挡住了——它根本不走 bridge').toHaveBeenCalledTimes(1);
    expect(checkCeceliaRunAvailable).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalledWith({ task_id: 'q1', status: 'queued' });
    expect(r).toMatchObject({ dispatched: true, task_id: 'q1' });
  });

  it('bridge 健康检查不可用时 qiumi 也不回滚 queued（第二道闸同样豁免）', async () => {
    _candidatePool = [candidate];
    wireQueries();
    routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
    checkCeceliaRunAvailable.mockResolvedValue({ available: false, error: 'bridge down' });

    const r = await dispatchNextTask(null);

    expect(mockTriggerCeceliaRun).toHaveBeenCalledTimes(1);
    expect(checkCeceliaRunAvailable).not.toHaveBeenCalled();
    expect(r).toMatchObject({ dispatched: true, task_id: 'q1' });
  });

});

describe('同机串行（任务 5ad81457）：同一台手机已有秋米任务在跑 → 本轮不派，保持 queued 换下一个', () => {
  const hint = (serial) => ({ source: 'native-agent', device_hint: { is_device: true, serial, host: 'us-mac-m4' } });
  const routedRow = (serial, extra = {}) => ({
    ...fullRow, payload: { ...fullRow.payload, qiumi_route: hint(serial), ...extra },
  });
  /** busySerial：库里另一张 in_progress 秋米任务占着的序列号 */
  function wire(row, busySerial) {
    routeQiumiTask.mockResolvedValue({outcome:'agent',payloadPatch:{qiumi_route:row.payload?.qiumi_route}});
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [row] };
      if (/device_hint/.test(sql) && /in_progress/.test(sql)) {
        return { rows: params?.[1] === busySerial ? [{ id: 'q0-busy', started_at: null }] : [] };
      }
      return { rows: [], rowCount: 1 };
    });
  }

  it('已路由的任务：同 serial 已有 in_progress → skip、放 claim、进 holSkipIds、记 task_events', async () => {
    wire(routedRow('S1'), 'S1');
    const holSkipIds = [];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds });
    expect(r).toEqual({ outcome: 'skip' });
    expect(holSkipIds).toContain('q1');
    expect(sqlsOf().some((s) => /claimed_by = NULL/.test(s)), 'claim 泄漏').toBe(true);
    const ev = mockQuery.mock.calls.find(([s, p]) => /INSERT INTO task_events/.test(s) && p?.[1] === 'qiumi_dispatch_device_busy');
    expect(ev, '没记 task_events').toBeTruthy();
    expect(JSON.parse(ev[1][2])).toMatchObject({ serial: 'S1', busy_task_id: 'q0-busy' });
    const gate = sqlsOf().find((s) => /device_hint/.test(s) && /in_progress/.test(s));
    expect(gate).toMatch(/task_type = 'qiumi_task'/);
    expect(gate).toMatch(/id <> \$1/);
  });

  it('不同 serial → 照派（proceed）', async () => {
    wire(routedRow('S2'), 'S1');
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });
    expect(r).toEqual({ outcome: 'proceed' });
  });

  it('没有 serial（非设备活）→ 不查同机闸，照派', async () => {
    wire({ ...fullRow, payload: { ...fullRow.payload, qiumi_route: { source: 'native-agent' } } }, 'S1');
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [] });
    expect(r).toEqual({ outcome: 'proceed' });
    expect(sqlsOf().some((s) => /device_hint/.test(s) && /in_progress/.test(s))).toBe(false);
  });

  it('新路由定到 S1 且 S1 忙 → 决策照落库，但本轮 skip', async () => {
    wire(fullRow, 'S1');
    routeQiumiTask.mockResolvedValue({
      outcome: 'agent', model: 'm', runId: 'qiumi-q1-2',
      payloadPatch: { run_id: 'qiumi-q1-2', qiumi_route: hint('S1') },
    });
    const holSkipIds = [];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds });
    expect(persistDecision).toHaveBeenCalled();
    expect(r).toEqual({ outcome: 'skip' });
    expect(holSkipIds).toContain('q1');
  });

});

it.each([
  {task_type:'initiative_plan',payload:{}},
  {task_type:'scope_plan',payload:{}},
  {task_type:'architecture_scan',payload:{skill_override:'/decomp'}},
])('退役规划和覆盖任务在认领前原子停放 %j', async task => {
  _candidatePool=[{...candidate,...task}]; wireQueries();
  const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>sql.includes('blocked_reason = $3') ? {rows:[{id:'q1'}],rowCount:1} : prior(sql,args));
  expect(await dispatchNextTask(null)).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
  expect(mockTriggerCeceliaRun).not.toHaveBeenCalled(); expect(mockRecordFailure).not.toHaveBeenCalled();
});

it.each(['decomposition_quality','initiative_plan'])('旧拆解审核 %s 即使携带 Cortex 标记也停放', async review_scope => {
  _candidatePool=[{...candidate,task_type:'decomp_review',payload:{review_scope,requires_cortex:true}}]; wireQueries();
  const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>sql.includes('blocked_reason = $3') ? {rows:[{id:'q1'}],rowCount:1} : prior(sql,args));
  expect(await dispatchNextTask(null)).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
  expect(processCortexTask).not.toHaveBeenCalled(); expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
});

it('计划调整审核的 Cortex 分支保持现役语义', async () => {
  const row={...candidate,task_type:'decomp_review',payload:{review_scope:'plan_adjustment',requires_cortex:true}};
  _candidatePool=[row]; wireQueries({row});
  await dispatchNextTask(null);
  expect(processCortexTask).toHaveBeenCalledOnce();
  expect(mockQuery.mock.calls.some(([sql])=>sql.includes('blocked_reason = $3'))).toBe(false);
});

it('退役规划即使携带 Cortex 标记也在认领前停放，普通 Cortex 仍有专用回归', async () => {
  _candidatePool=[{...candidate,task_type:'initiative_plan',payload:{requires_cortex:true}}]; wireQueries();
  const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>sql.includes('blocked_reason = $3') ? {rows:[{id:'q1'}],rowCount:1} : prior(sql,args));
  expect(await dispatchNextTask(null)).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
  expect(processCortexTask).not.toHaveBeenCalled(); expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
});

describe('退役拆解任务自动派发', () => {
  it.each([{decomposition:true},{decomposition:'true'},{decomposition:'continue'},{decomposition:'okr'},{next_action:'decompose'}])('旧标记 %j 在 claim 和启动前停放', async (payload) => {
    _candidatePool = [{...candidate, task_type:'dev', payload}];
    wireQueries();
    const prior = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql,args) => {
      if (sql.includes("blocked_reason = $3")) return {rows:[{id:'q1'}],rowCount:1};
      return prior(sql,args);
    });
    const result = await dispatchNextTask(null);
    expect(result).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
    expect(emit).toHaveBeenCalledWith('task:blocked','dispatcher',expect.objectContaining({task_id:'q1',reason:'retired_decomposition'}));
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([s])=>/UPDATE tasks SET claimed_by = \$1/.test(s))).toBe(false);
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });
  it('CAS 未命中时不假称已停放，不启动', async () => {
    _candidatePool = [{...candidate, task_type:'dev', payload:{decomposition:'true'}}];
    wireQueries();
    const prior = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql,args) => {
      if (sql.includes("blocked_reason = $3")) return {rows:[],rowCount:0};
      return prior(sql,args);
    });
    const result = await dispatchNextTask(null);
    expect(result).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:false});
    expect(emit).not.toHaveBeenCalled();
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });
});

it('秋米专用任务携带同名字段仍走其真实派发分支', async () => {
  const row={...fullRow,payload:{...fullRow.payload,decomposition:'true'}};
  _candidatePool=[{...candidate,payload:row.payload}];
  wireQueries({row});
  routeQiumiTask.mockResolvedValue({outcome:'agent',payloadPatch:{qiumi_route:{source:'native-agent'}}});
  const result=await dispatchNextTask(null);
  expect(result).toMatchObject({dispatched:true,task_id:'q1'});
  expect(routeQiumiTask).toHaveBeenCalledOnce();
  expect(mockQuery.mock.calls.some(([sql])=>sql.includes('blocked_reason = $3'))).toBe(false);
});

it('独立 Cortex RCA 即使含同名标记仍走自身处理，不走拆解', async () => {
  const row={...candidate,task_type:'research',payload:{requires_cortex:true,decomposition:'true'}};
  _candidatePool=[row]; wireQueries({row});
  await dispatchNextTask(null);
  expect(processCortexTask).toHaveBeenCalledOnce();
  expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql])=>sql.includes('blocked_reason = $3'))).toBe(false);
});

it('选中后 payload 变为旧拆解，不启动、不回队三振且仅停放自己的 claim', async () => {
  const selected={...candidate,task_type:'research',created_at:'2020-01-01T00:00:00.000Z',payload:{decomposition:'known'}};
  const latest={...selected,status:'in_progress',payload:{decomposition:'true'}};
  _candidatePool=[selected]; wireQueries({row:latest});
  const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>{
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return {rows:[{id:'q1',claim_stamp:'2026-11-07 00:00:00.123456+00'}]};
    if (sql.includes('blocked_reason = $3') && sql.includes('claimed_by = $6')) return {rows:[{id:'q1'}],rowCount:1};
    return prior(sql,args);
  });
  mockTriggerCeceliaRun.mockResolvedValue({success:false,reason:'retired_decomposition'});
  const result=await dispatchNextTask(null);
  expect(result).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
  expect(mockUpdateTask).not.toHaveBeenCalledWith({task_id:'q1',status:'queued'});
  expect(mockRecordFailure).not.toHaveBeenCalled();
  const park=mockQuery.mock.calls.find(([s])=>s.includes('blocked_reason = $3') && s.includes('claimed_by = $6'));
  expect(park[0]).toContain('claimed_at = $7::timestamptz');
  expect(park[1][6]).toBe('2026-11-07 00:00:00.123456+00');
});

it.each(['owner_changed','database_error'])('旧拆解竞态 %s 不得无条件回滚或计熔断', async (mode) => {
  const selected={...candidate,task_type:'research',created_at:'2020-01-01T00:00:00.000Z',payload:{decomposition:'known'}};
  const latest={...selected,status:'in_progress',payload:{decomposition:'true'}};
  _candidatePool=[selected]; wireQueries({row:latest});
  const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>{
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return {rows:[{id:'q1',claim_stamp:'2026-11-07 00:00:00.123456+00'}]};
    if (sql.includes('blocked_reason = $3') && sql.includes('claimed_by = $6')) {
      if(mode==='database_error') throw Error('owned PG unavailable');
      return {rows:[],rowCount:0};
    }
    if (sql.includes("status='queued', claimed_by=NULL")) return {rows:[],rowCount:0};
    return prior(sql,args);
  });
  mockTriggerCeceliaRun.mockResolvedValue({success:false,reason:'retired_decomposition'});
  const result=await dispatchNextTask(null);
  expect(result).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:false});
  expect(mockUpdateTask).not.toHaveBeenCalledWith({task_id:'q1',status:'queued'});
  expect(mockRecordFailure).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([s])=>/UPDATE tasks SET claimed_by = NULL WHERE id = \$1/.test(s))).toBe(false);
  if(mode==='database_error') expect(result.stateUnknown).toBe(true);
});

it('旧拆解停放后事件失败仍不启动，也不伪造未停放', async () => {
  _candidatePool=[{...candidate,task_type:'dev',payload:{decomposition:'true'}}];
  wireQueries(); const prior=mockQuery.getMockImplementation();
  mockQuery.mockImplementation(async(sql,args)=>sql.includes('blocked_reason = $3')
    ? {rows:[{id:'q1'}],rowCount:1} : prior(sql,args));
  emit.mockRejectedValueOnce(new Error('event unavailable'));
  const result=await dispatchNextTask(null);
  expect(result).toMatchObject({dispatched:false,reason:'retired_decomposition',parked:true});
  expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  expect(mockRecordFailure).not.toHaveBeenCalled();
});

it('路由异常的旧claim清理不能释放随后取得的新claim',async()=>{
 let owner='old-owner';routeQiumiTask.mockRejectedValue(Error('route unavailable'));
 mockQuery.mockImplementation(async(sql,args)=>{if(/UPDATE tasks SET claimed_by = NULL/.test(sql)&&(!sql.includes('AND claimed_by = $2')||args[1]===owner))owner=null;return {rows:[fullRow]};});
 recordDispatchResult.mockImplementationOnce(async()=>{owner='new-owner';throw Error('stats unavailable');});
 expect(await dispatchQiumiTask(candidate,{claimOwner:'old-owner'})).toMatchObject({outcome:'skip'});expect(owner).toBe('new-owner');
});
it('重新排队的历史OpenClaw run明确受阻，不能重派原生会话',async()=>{
 wireQueries({row:{...fullRow,executor_kind:'openclaw-agent',payload:{...fullRow.payload,run_id:'old-qiumi-run'}}});
 expect(await dispatchQiumiTask(candidate)).toMatchObject({outcome:'return',result:{reason:'native_agent_legacy_run_requires_review'}});
 expect(routeQiumiTask).not.toHaveBeenCalled();expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
});
it('原生执行观察未知保留在途状态，不回队、不释放claim或重复启动',async()=>{
 _candidatePool=[candidate];wireQueries();routeQiumiTask.mockResolvedValue({outcome:'agent',payloadPatch:{}});
 mockTriggerCeceliaRun.mockResolvedValue({success:false,dispatchUncertain:true,reason:'native_agent_execution_unknown',runId:'native-original'});
 expect(await dispatchNextTask(null)).toMatchObject({dispatched:false,execution_unknown:true,run_id:'native-original'});
 expect(mockTriggerCeceliaRun).toHaveBeenCalledOnce();expect(mockUpdateTask).not.toHaveBeenCalledWith({task_id:'q1',status:'queued'});
 expect(sqlsOf().some(sql=>/UPDATE tasks SET claimed_by = NULL/.test(sql))).toBe(false);
});
it('原生观察结果统计失败不得回滚已启动会话或释放claim',async()=>{
 _candidatePool=[candidate];wireQueries();routeQiumiTask.mockResolvedValue({outcome:'agent',payloadPatch:{}});
 mockTriggerCeceliaRun.mockResolvedValue({success:true,runId:'native-original'});recordDispatchResult.mockRejectedValueOnce(Error('native stats unavailable'));
 expect(await dispatchNextTask(null)).toMatchObject({dispatched:true,task_id:'q1'});
 expect(mockUpdateTask).not.toHaveBeenCalledWith({task_id:'q1',status:'queued'});
 expect(sqlsOf().some(sql=>/UPDATE tasks SET claimed_by = NULL/.test(sql))).toBe(false);
});
