/**
 * 测试 Bug #1: triggerCeceliaRun 失败时不应返回 dispatched=true
 * 测试 Bug #5: processCortexTask 失败时应调用 handleTaskFailure 进行 quarantine 检查
 *
 * DoD 映射：
 * - triggerCeceliaRun success=false → revert to queued, return dispatched=false
 * - triggerCeceliaRun success=false → recordFailure('cecelia-run') 被调用
 * - processCortexTask catch → handleTaskFailure 被调用
 * - processCortexTask 反复失败 → quarantine
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

// llm-capacity 自 2026-09-22 起会去读 ops_model_accounts（codex/grok 的可用性
// 从本机凭据文件改为走配额账本）。本文件的 mockQuery 是**按调用顺序**排队响应的
// （mockResolvedValueOnce），多出来的那次账本查询会把后面全部错位 —— 而本文件
// 测的是派发收口，跟容量快照无关。直接把容量模块整个 mock 掉，别让它碰 db。
vi.mock('../llm-capacity.js', () => ({
  getLlmCapacitySnapshot: vi.fn().mockResolvedValue({
    sampled_at: '2026-09-22T00:00:00.000Z',
    sentinel: 'ok',
    healthy: true,
    errors: [],
    vendors: {
      claude: { vendor: 'claude', available_count: 2, total_count: 2, poller: 'ok', error: null, accounts: [] },
      codex: { vendor: 'codex', available_count: 5, total_count: 5, poller: 'ok', error: null, accounts: [] },
      grok: { vendor: 'grok', available_count: 1, total_count: 1, poller: 'ok', error: null, accounts: [] },
    },
  }),
  summarizeLlmCapacity: vi.fn((s) => s),
  chooseGuidedExecutor: vi.fn(() => ({ executor: 'claude', level: 'L1_primary_claude', reason: 'primary_vendor_available' })),
  clearLlmCapacityCache: vi.fn(),
  CODEX_ACCOUNTS: [],
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  }),
  shouldBypassBackpressure: vi.fn(() => false),

}));

const mockIsAllowed = vi.fn().mockReturnValue(true);
const mockRecordFailure = vi.fn();
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
  recordSuccess: vi.fn(),
  recordFailure: (...args) => mockRecordFailure(...args),
  getAllStates: vi.fn().mockReturnValue({})
}));


const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));

const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn().mockReturnValue(0),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn()
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined)
}));

const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

const mockHandleTaskFailure = vi.fn();
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: (...args) => mockHandleTaskFailure(...args),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([])
}));

// quota-guard: fail-open（不限制优先级），避免测试 DB 调用干扰 mock 序列
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));

// account-usage: mock proactiveTokenCheck 避免真实 DB 调用消耗 mock 序列
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue(undefined),
  selectBestAccount: vi.fn().mockResolvedValue({ account: 'account2', model: 'claude-sonnet-4-6' }),
  getAccountUsage: vi.fn().mockResolvedValue([]),
  refreshUsageCache: vi.fn().mockResolvedValue(undefined),
  markAuthFailure: vi.fn().mockResolvedValue(undefined),
  getAuthFailedAccounts: vi.fn().mockReturnValue([]),
}));

// 派发收口测试只替换候选选择，保留processCortexTask真实实现。
const mockSelectCandidate = vi.fn();
vi.mock('../dispatch-helpers.js', async original => ({
  ...await original(), selectNextDispatchableTask: (...args) => mockSelectCandidate(...args),
}));
const unexpectedSql = [];
beforeEach(() => {
  mockQuery.mockReset();
  mockSelectCandidate.mockReset();
  mockTriggerCeceliaRun.mockReset();
  unexpectedSql.length = 0;
});
afterEach(() => { expect(unexpectedSql).toEqual([]); });
function setupDispatch(task) {
  mockSelectCandidate.mockResolvedValueOnce(task).mockResolvedValue(null);
  mockQuery.mockImplementation(async (statement, values = []) => {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    if (/^UPDATE tasks SET claimed_by = \$1/.test(sql)) return {rows:[{id:task.id,claim_stamp:'owned-claim'}],rowCount:1};
    if (/^SELECT \* FROM tasks WHERE id/.test(sql)) return {rows:[task],rowCount:1};
    if (/^SELECT count\(\*\)::int AS n FROM tasks/.test(sql)) return {rows:[{n:0}],rowCount:1};
    if (/^SELECT value_json FROM working_memory WHERE key/.test(sql)) return {rows:[],rowCount:0};
    if (/^SELECT metadata FROM tasks WHERE id/.test(sql)) return {rows:[{metadata:{}}],rowCount:1};
    if (/^SELECT id, run_id FROM task_runs WHERE run_id/.test(sql)) return {rows:[{id:'owned-run',run_id:values[0]}],rowCount:1};
    if (/^SELECT tasks\.id AS id/.test(sql)) return {rows:[],rowCount:0};
    if (/^(?:INSERT|UPDATE)\b/.test(sql)) return {rows:[],rowCount:1};
    unexpectedSql.push(sql); throw Error(`unexpected_test_sql: ${sql}`);
  });
}

describe('Bug #1: triggerCeceliaRun 失败时 revert 任务并返回 dispatched=false', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executor success=false → dispatched=false, task reverted to queued', async () => {
    const task = {
      id: 'task-exec-fail', title: 'Good task title here',
      description: '有完整描述的合法任务，应该通过 pre-flight', task_type:'research',
      status: 'queued', priority: 'P1', payload: {},
      created_at: '2026-07-16T00:00:00Z',
    };

    // triggerCeceliaRun 返回 success=false
    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: false,
      taskId: task.id,
      reason: 'bridge_error',
      error: 'Bridge connection refused'
    });

    setupDispatch(task);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    // 核心断言：dispatched 必须是 false
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('executor_failed');
    expect(result.task_id).toBe('task-exec-fail');

    // 任务被 revert 回 queued
    expect(mockUpdateTask).toHaveBeenCalledWith({
      task_id: 'task-exec-fail',
      status: 'queued'
    });

    // circuit-breaker recordFailure 被调用
    expect(mockRecordFailure).toHaveBeenCalledWith('cecelia-run');

    // dispatch stats 记录失败（task 94ee0ec4 fail-closed：失败回执必须带 task_id 可归因）
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(
      expect.anything(), false, 'executor_failed', undefined, 'task-exec-fail'
    );
  });

  it('executor success=true → dispatched=true (正常路径不受影响)', async () => {
    const task = {
      id: 'task-exec-ok', title: 'Normal working task',
      description: '正常任务应该成功派发', task_type:'research',
      status: 'queued', priority: 'P1', payload: {},
      created_at: '2026-07-16T00:00:00Z',
    };

    mockTriggerCeceliaRun.mockResolvedValueOnce({
      success: true,
      runId: 'run-ok-123',
      taskId: task.id
    });

    setupDispatch(task);

    const { dispatchNextTask } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1']);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('task-exec-ok');

    // revert 不应该被调用（updateTask 只在 in_progress 时调用）
    const revertCalls = mockUpdateTask.mock.calls.filter(
      c => c[0].status === 'queued'
    );
    expect(revertCalls).toHaveLength(0);

    // recordFailure 不应该被调用
    expect(mockRecordFailure).not.toHaveBeenCalled();
  });

});

describe('Bug #5: processCortexTask 失败时调用 handleTaskFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cortex 任务异常时调用 handleTaskFailure 而非直接 UPDATE failed', async () => {
    // 模拟 handleTaskFailure 返回未隔离（失败次数不够）
    mockHandleTaskFailure.mockResolvedValueOnce({
      quarantined: false,
      failure_count: 1
    });

    const cortexTask = {
      id: 'cortex-fail-1',
      title: 'RCA Analysis Task',
      description: 'Deep analysis',
      status: 'queued',
      priority: 'P1',
      payload: { requires_cortex: true, trigger: 'test', signals: {} }
    };

    // Mock cortex.js to throw
    vi.doMock('../cortex.js', () => ({
      performRCA: vi.fn().mockRejectedValue(new Error('Cortex LLM timeout'))
    }));

    // 1. UPDATE payload (rca_error)
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // 2+ other DB calls
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { processCortexTask } = await import('../tick.js');
    const result = await processCortexTask(cortexTask, []);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('cortex_error');

    // 核心断言：handleTaskFailure 被调用
    expect(mockHandleTaskFailure).toHaveBeenCalledWith('cortex-fail-1');

    // updateTask 被调用设置 failed（因为未达到 quarantine 阈值）
    expect(mockUpdateTask).toHaveBeenCalledWith({
      task_id: 'cortex-fail-1',
      status: 'failed'
    });
  });

  it('cortex 任务反复失败达到阈值时被 quarantine', async () => {
    // 模拟 handleTaskFailure 返回已隔离
    mockHandleTaskFailure.mockResolvedValueOnce({
      quarantined: true,
      result: { reason: 'repeated_failure' },
      failure_count: 3
    });

    const cortexTask = {
      id: 'cortex-quarantine-1',
      title: 'Failing RCA Task',
      description: 'Repeatedly failing',
      status: 'queued',
      priority: 'P1',
      payload: { requires_cortex: true, trigger: 'test', signals: {} }
    };

    vi.doMock('../cortex.js', () => ({
      performRCA: vi.fn().mockRejectedValue(new Error('Cortex API unavailable'))
    }));

    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const { processCortexTask } = await import('../tick.js');
    const result = await processCortexTask(cortexTask, []);

    expect(result.dispatched).toBe(false);
    expect(mockHandleTaskFailure).toHaveBeenCalledWith('cortex-quarantine-1');

    // quarantine 时不应该再调用 updateTask(status='failed')
    const failedCalls = mockUpdateTask.mock.calls.filter(
      c => c[0].status === 'failed'
    );
    expect(failedCalls).toHaveLength(0);
  });
});

describe('现役执行体按实际依赖使用bridge可用性闸', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('bridge不可用时OpenClaw任务仍可派发且不回滚claim', async () => {
    const executor = await import('../executor.js');
    executor.checkCeceliaRunAvailable.mockResolvedValue({available:false,error:'Bridge not running'});
    const task={id:'openclaw-direct',title:'现役OpenClaw任务',description:'独立远端执行体',task_type:'qiumi_task',status:'queued',priority:'P1',payload:{run_id:'owned-qiumi-route',model:'openai/gpt-5.6-terra',qiumi_route:{source:'jev'}}};
    setupDispatch(task);
    mockTriggerCeceliaRun.mockResolvedValueOnce({success:true,taskId:task.id,runId:'owned-openclaw-run'});
    const {dispatchNextTask}=await import('../tick.js');
    expect(await dispatchNextTask(['goal-1'])).toMatchObject({dispatched:true,task_id:task.id});
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({task_type:'qiumi_task'}));
    expect(executor.checkCeceliaRunAvailable).not.toHaveBeenCalled();
    expect(mockUpdateTask.mock.calls.filter(([row])=>row?.status==='queued')).toHaveLength(0);
    executor.checkCeceliaRunAvailable.mockResolvedValue({available:true});
  });
  it('bridge不可用时普通研究任务受阻，保留可用性闸', async () => {
    const executor=await import('../executor.js');
    executor.checkCeceliaRunAvailable.mockResolvedValueOnce({available:false,error:'Bridge not running'});
    const task={id:'bridge-research',title:'研究任务',description:'依赖现役bridge',task_type:'research',status:'queued',priority:'P1',payload:{},created_at:'2026-07-16T00:00:00Z'};
    setupDispatch(task);
    const {dispatchNextTask}=await import('../tick.js');
    expect(await dispatchNextTask(['goal-1'])).toMatchObject({dispatched:false,reason:'no_executor'});
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });
});
