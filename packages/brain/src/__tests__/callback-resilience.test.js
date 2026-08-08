/**
 * callback-resilience.test.js
 * 验收：execution-callback 韧性改动
 *  1. updated_at = NOW() 刷新
 *  2. claimed_by / claimed_at 清空
 *  3. 任务已 terminal 时迟到回调返回 200 + {skipped:true, reason:'late_callback_terminal'}
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const mockClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(() => mockClient),
}));
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
  triggerCeceliaRun: vi.fn(async () => ({})),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(),
  triggerN8n: vi.fn(), setMemory: vi.fn(), batchUpdateTasks: vi.fn(),
}));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(),
  executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn(), LOCATION_MAP: {},
}));
vi.mock('../okr-tick.js', () => ({
  executeOkrTick: vi.fn(), runOkrTickSafe: vi.fn(), startOkrTickLoop: vi.fn(),
  stopOkrTickLoop: vi.fn(), getOkrTickStatus: vi.fn(), addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(), getPendingQuestions: vi.fn(), OKR_STATUS: {},
}));
vi.mock('../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(), runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(), stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn(), getDailyReports: vi.fn(),
}));
vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn(),
}));
vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(), generatePrdFromGoalKR: vi.fn(), generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(), validatePrd: vi.fn(), validateTrd: vi.fn(),
  prdToJson: vi.fn(), trdToJson: vi.fn(), PRD_TYPE_MAP: {},
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(), generateDecision: vi.fn(),
  executeDecision: vi.fn(), getDecisionHistory: vi.fn(), rollbackDecision: vi.fn(),
}));
vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(), getPlanStatus: vi.fn(), handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(), selectTopAreas: vi.fn(), selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));
vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn(), queryEvents: vi.fn(), getEventCounts: vi.fn(), emit: vi.fn(),
}));
vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(), reset: vi.fn(), getAllStates: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn(),
}));
const classifyFailureMock = vi.hoisted(() => vi.fn(() => ({ class: 'task_error', retry_strategy: null })));
const handleTaskFailureMock = vi.hoisted(() => vi.fn(async () => ({ quarantined: false, failure_count: 2 })));
vi.mock('../quarantine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  classifyFailure: classifyFailureMock,
  handleTaskFailure: handleTaskFailureMock,
}));
const thalamusProcessEventMock = vi.hoisted(() => vi.fn(async () => ({ level: 0, actions: [] })));
vi.mock('../thalamus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  processEvent: thalamusProcessEventMock,
}));
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(async () => {}),
  notifyTaskFailed: vi.fn(async () => {}),
}));

import { recordFailure as recordCircuitFailure } from '../circuit-breaker.js';

let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../routes.js');
  router = mod.default;
});

function mockReqRes(method, path, body = {}) {
  return new Promise((resolve) => {
    const req = { method, path, body, query: {}, params: {} };
    const resData = { statusCode: 200, body: null };
    const res = {
      status: (code) => { resData.statusCode = code; return res; },
      json: (data) => { resData.body = data; resolve(resData); },
    };
    const layers = router.stack.filter(layer => {
      if (!layer.route) return false;
      return layer.route.path === path && Object.keys(layer.route.methods)[0] === method.toLowerCase();
    });
    if (layers.length === 0) { resolve({ statusCode: 404, body: { error: 'Not found' } }); return; }
    const handler = layers[0].route.stack[0].handle;
    handler(req, res).catch(err => { resData.statusCode = 500; resData.body = { error: err.message }; resolve(resData); });
  });
}

// 默认 pool.query mock：callback_queue INSERT 成功；status SELECT 返回 in_progress；其余返回空
function setupDefaultMocks({ taskStatus = 'in_progress' } = {}) {
  mockPool.query.mockImplementation((sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    // callback_queue INSERT
    if (s.includes('INSERT INTO callback_queue')) return Promise.resolve({ rows: [{ id: 'callback-row-1' }], rowCount: 1 });
    if (s.includes('UPDATE callback_queue')) return Promise.resolve({ rows: [], rowCount: 1 });
    // 终态守卫查询 — SELECT status FROM tasks
    if (s.includes('SELECT status FROM tasks')) return Promise.resolve({ rows: [{ status: taskStatus }], rowCount: 1 });
    // 幂等检查 decision_log
    if (s.includes('decision_log')) return Promise.resolve({ rows: [], rowCount: 0 });
    // completed_no_pr 检查 (SELECT task_type FROM tasks)
    if (s.includes('task_type')) return Promise.resolve({ rows: [{ task_type: 'dev' }], rowCount: 1 });
    // pipeline_terminal_failure 检查
    if (s.includes('failure_class')) return Promise.resolve({ rows: [{ failure_class: null }], rowCount: 1 });
    // 其余
    return Promise.resolve({ rows: [{ goal_id: null }], rowCount: 1 });
  });
  mockClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
}

describe('execution-callback 韧性：updated_at / claim 清空', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('UPDATE tasks SQL 包含 updated_at = NOW()', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-resil-1',
      run_id: 'run-resil-1',
      status: 'AI Done',
      result: { result: 'ok' },
    });

    const updateCall = mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall, 'UPDATE tasks 调用未找到').toBeDefined();
    expect(updateCall[0]).toContain('updated_at = NOW()');
    expect(updateCall[0]).toContain("payload->>'current_run_id' = $14::text");
    expect(updateCall[0]).not.toContain("payload->>'current_run_id' IS NULL");
  });

  it('UPDATE tasks SQL 包含 claimed_by = NULL', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-resil-2',
      run_id: 'run-resil-2',
      status: 'AI Done',
    });

    const updateCall = mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('claimed_by = NULL');
    expect(updateCall[0]).toContain('claimed_at = NULL');
  });

  it('AI Failed 时同样刷新 updated_at 并清 claim', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-resil-3',
      run_id: 'run-resil-3',
      status: 'AI Failed',
    });

    const updateCall = mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('updated_at = NOW()');
    expect(updateCall[0]).toContain('claimed_by = NULL');
  });

  it('HTTP consumer 以数据库租约占有 callback_queue 行，成功后标记 processed', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-callback-lease',
      run_id: 'run-callback-lease',
      status: 'AI Done',
      result: { result: 'ok' },
    });

    const insertCall = mockPool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO callback_queue')
    );
    expect(insertCall[0]).toContain('claimed_at');
    expect(insertCall[0]).toContain('claimed_by');
    expect(insertCall[0]).toContain('RETURNING id');

    const finishCall = mockPool.query.mock.calls.find(
      ([sql, params]) => typeof sql === 'string' && sql.includes('UPDATE callback_queue') && sql.includes('processed_at = NOW()') && params?.[0] === 'callback-row-1'
    );
    expect(finishCall, 'inline consumer 完成后必须收口 queue lease').toBeDefined();
  });

  it('HTTP callback 的 task_error 不得污染全局 cecelia-run 熔断器', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-error-circuit-boundary',
      run_id: 'run-error-circuit-boundary',
      status: 'AI Failed',
      result: { error: 'task contract error' },
      iterations: 1,
    });

    expect(recordCircuitFailure).not.toHaveBeenCalledWith('cecelia-run');
  });

  it('HTTP callback 交给 Thalamus 的 retry_count 来自持久化 failure_count', async () => {
    handleTaskFailureMock.mockResolvedValueOnce({ quarantined: false, failure_count: 2 });
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-persisted-retry-count',
      run_id: 'run-persisted-retry-count',
      status: 'AI Failed',
      result: { error: 'second failure' },
      iterations: 1,
    });

    expect(thalamusProcessEventMock).toHaveBeenCalledWith(expect.objectContaining({ retry_count: 2 }));
  });
});

describe('execution-callback 终态幂等：迟到回调返回 200', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const TERMINAL_STATUSES = ['completed', 'completed_no_pr', 'failed', 'quota_exhausted'];

  for (const terminalStatus of TERMINAL_STATUSES) {
    it(`任务已是 ${terminalStatus} → 返回 200 + skipped:true`, async () => {
      setupDefaultMocks({ taskStatus: terminalStatus });

      const result = await mockReqRes('POST', '/execution-callback', {
        task_id: `task-terminal-${terminalStatus}`,
        run_id: `run-terminal-${terminalStatus}`,
        status: 'AI Done',
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.success).toBe(true);
      expect(result.body.skipped).toBe(true);
      expect(result.body.reason).toBe('late_callback_terminal');
      expect(result.body.current_status).toBe(terminalStatus);
    });
  }

  it('任务为 in_progress 时正常处理，不跳过', async () => {
    setupDefaultMocks({ taskStatus: 'in_progress' });

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-in-progress',
      run_id: 'run-in-progress',
      status: 'AI Done',
    });

    expect(result.statusCode).toBe(200);
    // 正常处理时不应有 skipped:true
    expect(result.body.skipped).not.toBe(true);

    // 应有 UPDATE tasks 调用（进入了事务）
    const updateCall = mockClient.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
  });
});
