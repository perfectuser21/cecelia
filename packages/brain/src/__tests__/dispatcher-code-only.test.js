import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockTaskEvent=vi.fn(async()=>{});
vi.mock('../lib/task-event-log.js',()=>({recordTaskEventSafe:(...args)=>mockTaskEvent(...args)}));
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

vi.mock('../routing/qiumi-router.js', () => ({
  routeQiumiTask: vi.fn(),
  persistDecision: vi.fn().mockResolvedValue(undefined),
}));

let _drain = false;
let _cooling = false;
let _fleet = [{id:'us-mac-m4',online:true,pressure:0.2}];
const mockScriptDispatch = vi.fn(async()=>({outcome:'proceed'}));
vi.mock('../script-executor.js',()=>({dispatchScriptTask:(...args)=>mockScriptDispatch(...args),SCRIPT_BREAKER_KEY:'script'}));
vi.mock('../fleet-resource-cache.js',()=>({getFleetStatus:()=>_fleet}));
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
vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => _cooling, getQuotaCoolingState: () => ({ until: null }) }));
vi.mock('../drain.js', () => ({ isDraining: () => _drain, getDrainStartedAt: () => null }));

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
const codeTask={id:'code1',task_type:'script_run',status:'queued',priority:'P2',created_at:now,title:'手机巡查',payload:{host:'mmv',cmd:'true',timeout_sec:30,runtime_requires_llm:false,workflow_id:'12345678-1234-1234-1234-123456789012'}};
const fullRow = { ...qiumi, payload: { qiumi_source: buildQiumiSource({ title: qiumi.title }) } };

/** 按 SQL 形状回答，不靠调用次序 */
function wireQueries() {
  mockQuery.mockImplementation(async (sql) => {
    if (/UPDATE tasks SET claimed_by = \$1/.test(sql)) return { rows: [{ id: _candidatePool[0]?.id??'q1' }] };
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [_candidatePool[0]??fullRow] };
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
  mockUpdateTask.mockResolvedValue({ success: true });
  _drain=false;_cooling=false;_fleet=[{id:'us-mac-m4',online:true,pressure:0.2}];
  mockScriptDispatch.mockResolvedValue({outcome:'proceed'});
  routeQiumiTask.mockResolvedValue({ outcome: 'agent', model: 'm', runId: 'r1', payloadPatch: {} });
});


describe('受控代码选择不使用 AI 预算',()=>{
 it('AI 池满仍实际派发一条明确代码任务',async()=>{
  _candidatePool=[codeTask];const result=await dispatchNextTask(null,{codeOnly:true});
  expect(result.dispatched).toBe(true);expect(mockScriptDispatch).toHaveBeenCalledTimes(1);
  expect(mockSelectNextDispatchableTask.mock.calls[0][2]).toMatchObject({codeOnly:true,onlyTaskTypes:['script_run']});
 });
 it('配额冷却不影响代码入口',async()=>{_cooling=true;_candidatePool=[codeTask];expect((await dispatchNextTask(null,{codeOnly:true})).dispatched).toBe(true);});
 it('全局停止仍阻止代码任务',async()=>{_drain=true;_candidatePool=[codeTask];expect((await dispatchNextTask(null,{codeOnly:true})).reason).toBe('draining');expect(mockScriptDispatch).not.toHaveBeenCalled();});
 it('目标机器离线保持不执行',async()=>{_fleet=[{id:'us-mac-m4',online:false,pressure:1}];_candidatePool=[codeTask];expect((await dispatchNextTask(null,{codeOnly:true})).dispatched).toBe(false);expect(mockScriptDispatch).not.toHaveBeenCalled();});
 it('目标实际 CPU 满保持不执行',async()=>{_fleet=[{id:'us-mac-m4',online:true,pressure:0.96}];_candidatePool=[codeTask];expect((await dispatchNextTask(null,{codeOnly:true})).dispatched).toBe(false);expect(mockScriptDispatch).not.toHaveBeenCalled();});
 it('过期健康报告给出明确队列原因且不点火',async()=>{_fleet=[{id:'us-mac-m4',online:false,pressure:1,admission_reason:'worker_health_stale'}];_candidatePool=[codeTask];await dispatchNextTask(null,{codeOnly:true});expect(mockTaskEvent.mock.calls[0][3].reason).toBe('worker_health_stale');expect(mockScriptDispatch).not.toHaveBeenCalled();});
 it('普通任务在池满时仍不得派发',async()=>{_candidatePool=[normal];expect((await dispatchNextTask(null)).reason).toBe('pool_c_full');expect(mockScriptDispatch).not.toHaveBeenCalled();});
});
