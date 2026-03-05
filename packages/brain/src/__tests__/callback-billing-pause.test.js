/**
 * Callback Billing Cap Tests
 *
 * 验证 execution-callback 在收到 Spending cap reached 错误时：
 * 1. 调用 markSpendingCap() 标记账号级 spending cap
 * 2. 不调用 cbFailure()（不计入熔断，billing cap 不是系统故障）
 * 3. result=null 时不抛 TypeError
 *
 * v1.197.0: spending cap 闭环 — 标记账号 → 换号重试 → 避免熔断
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track markSpendingCap and circuit-breaker calls
const markSpendingCapMock = vi.fn();
const cbFailureMock = vi.fn();
const cbSuccessMock = vi.fn();

// Legacy: setBillingPause (deprecated but still in executor mock)
const setBillingPauseMock = vi.fn();

// Mock client for transactions
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

// Mock pool
const mockPool = {
  query: vi.fn(),
  connect: vi.fn(() => mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

// Mock executor - expose setBillingPause as a spy
vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
  setBillingPause: setBillingPauseMock,
  getBillingPause: vi.fn(() => ({ active: false })),
  clearBillingPause: vi.fn(),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(),
  LOCATION_MAP: {},
}));
vi.mock('../okr-tick.js', () => ({
  executeOkrTick: vi.fn(),
  runOkrTickSafe: vi.fn(),
  startOkrTickLoop: vi.fn(),
  stopOkrTickLoop: vi.fn(),
  getOkrTickStatus: vi.fn(),
  addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(),
  getPendingQuestions: vi.fn(),
  OKR_STATUS: {},
}));
vi.mock('../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn(),
  getDailyReports: vi.fn(),
}));
vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(),
  parseAndCreate: vi.fn(),
  INTENT_TYPES: {},
  INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(),
  classifyIntent: vi.fn(),
  getSuggestedAction: vi.fn(),
}));
vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  getDecisionHistory: vi.fn(),
  rollbackDecision: vi.fn(),
}));
vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn(),
  getEventCounts: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(),
  reset: vi.fn(),
  getAllStates: vi.fn(),
  recordSuccess: cbSuccessMock,
  recordFailure: cbFailureMock,
}));
vi.mock('../account-usage.js', () => ({
  markSpendingCap: markSpendingCapMock,
  isSpendingCapped: vi.fn(() => false),
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'sonnet' })),
  selectBestAccountForHaiku: vi.fn(async () => 'account1'),
  getAccountUsage: vi.fn(async () => ({})),
  getSpendingCapStatus: vi.fn(() => []),
  isAllAccountsSpendingCapped: vi.fn(() => false),
  loadSpendingCapsFromDB: vi.fn(async () => {}),
}));
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(async () => {}),
  notifyTaskFailed: vi.fn(async () => {}),
}));

// Import router after mocks
const { default: router } = await import('../routes.js');

// Helper to simulate express request/response
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
      const routePath = layer.route.path;
      const routeMethod = Object.keys(layer.route.methods)[0];
      return routePath === path && routeMethod === method.toLowerCase();
    });

    if (layers.length === 0) {
      resolve({ statusCode: 404, body: { error: 'Not found' } });
      return;
    }

    const handler = layers[0].route.stack[0].handle;
    handler(req, res).catch(err => {
      resData.statusCode = 500;
      resData.body = { error: err.message };
      resolve(resData);
    });
  });
}

describe('execution-callback billing cap handling (v1.197.0)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markSpendingCapMock.mockClear();
    cbFailureMock.mockClear();
    cbSuccessMock.mockClear();
    setBillingPauseMock.mockClear();
    // Setup mock client to return task payload
    mockClient.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('BEGIN')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('COMMIT')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('UPDATE tasks SET status')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT payload FROM tasks')) {
        return Promise.resolve({ rows: [{ payload: { dispatched_account: 'account2' } }], rowCount: 1 });
      }
      if (typeof sql === 'string' && sql.includes('UPDATE tasks SET payload')) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (typeof sql === 'string' && sql.includes("status = 'queued'")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [{ goal_id: null }], rowCount: 0 });
    });
  });

  /**
   * DoD 1: result=null 时不应抛出 TypeError
   */
  it('should not throw TypeError when result=null', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-billing-null-result',
      run_id: 'run-billing-1',
      status: 'AI Failed',
      result: null,
    });

    expect(result.statusCode).toBe(200);
  });

  /**
   * DoD 2: spending cap 时调用 markSpendingCap 标记账号
   */
  it('should call markSpendingCap when billing cap detected with dispatched_account', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-billing-obj-result',
      run_id: 'run-billing-3',
      status: 'AI Failed',
      result: { result: 'Spending cap reached resets 11pm' },
    });

    expect(result.statusCode).toBe(200);
    // v1.197.0: spending cap 标记账号级 cap
    expect(markSpendingCapMock).toHaveBeenCalledWith('account2', expect.any(String));
  });

  /**
   * DoD 3: spending cap 时不调用 cbFailure（不计入熔断）
   */
  it('should NOT call cbFailure for billing cap failures', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-billing-no-cb',
      run_id: 'run-billing-4',
      status: 'AI Failed',
      result: { result: 'Spending cap reached resets 11pm' },
    });

    expect(result.statusCode).toBe(200);
    // billing cap 不是系统故障，不计入熔断
    expect(cbFailureMock).not.toHaveBeenCalled();
  });

  /**
   * DoD 4: 正常失败应调用 cbFailure（计入熔断）
   */
  it('should call cbFailure for normal task failures', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-normal-failure',
      run_id: 'run-normal-1',
      status: 'AI Failed',
      result: { error: 'Task failed: tests did not pass' },
    });

    expect(result.statusCode).toBe(200);
    expect(cbFailureMock).toHaveBeenCalledWith('cecelia-run');
    expect(markSpendingCapMock).not.toHaveBeenCalled();
  });

  /**
   * DoD 5: spending cap string result 时也应标记账号
   */
  it('should call markSpendingCap for spending cap string result', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-billing-str-result',
      run_id: 'run-billing-5',
      status: 'AI Failed',
      result: 'Spending cap reached resets 11pm',
    });

    expect(result.statusCode).toBe(200);
    expect(markSpendingCapMock).toHaveBeenCalledWith('account2', expect.any(String));
    expect(cbFailureMock).not.toHaveBeenCalled();
  });
});
