/**
 * Circuit Breaker Transient API Error Bypass Tests
 *
 * 验证 execution-callback 对瞬时 API 错误（rate_limit / network）不计入熔断：
 * - billing_cap（已有）：账号费用上限，不是系统故障
 * - rate_limit（新增）：429 限流，是 LLM API 瞬时错误，不是 cecelia-run 系统故障
 * - network（新增）：网络抖动，与 cecelia-run 健康状况无关
 *
 * 根因：LLM API 429 限流连续触发 3 次 → 误开熔断器 → 派发链路停摆 30 分钟
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track circuit-breaker calls
const cbFailureMock = vi.fn();
const cbSuccessMock = vi.fn();

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

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
  setBillingPause: vi.fn(),
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
  markSpendingCap: vi.fn(),
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

describe('circuit-breaker transient API error bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cbFailureMock.mockClear();
    cbSuccessMock.mockClear();

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
      if (typeof sql === 'string' && sql.includes('payload FROM tasks')) {
        return Promise.resolve({ rows: [{ task_type: 'dev', payload: {} }], rowCount: 1 });
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

  it('should NOT call cbFailure for rate_limit failures (429 限流)', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-rate-limit-1',
      run_id: 'run-rl-1',
      status: 'AI Failed',
      result: { result: 'Error: 429 Too Many Requests - rate limit exceeded' },
    });

    expect(result.statusCode).toBe(200);
    expect(cbFailureMock).not.toHaveBeenCalled();
  });

  it('should NOT call cbFailure for network failures (网络抖动)', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-network-1',
      run_id: 'run-net-1',
      status: 'AI Failed',
      result: { result: 'Error: ECONNRESET connection reset by peer' },
    });

    expect(result.statusCode).toBe(200);
    expect(cbFailureMock).not.toHaveBeenCalled();
  });

  it('should call cbFailure for normal task_error failures (正常任务错误仍计入熔断)', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-task-error-1',
      run_id: 'run-te-1',
      status: 'AI Failed',
      result: { error: 'Tests failed: 5 assertions failed' },
    });

    expect(result.statusCode).toBe(200);
    expect(cbFailureMock).toHaveBeenCalledWith('cecelia-run');
  });

  it('should NOT call cbFailure for billing_cap (already covered, regression test)', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-billing-1',
      run_id: 'run-billing-1',
      status: 'AI Failed',
      result: { result: 'Spending cap reached resets 11pm' },
    });

    expect(result.statusCode).toBe(200);
    expect(cbFailureMock).not.toHaveBeenCalled();
  });

  // AI Done path (cbSuccess) tested via circuit-breaker-success.test.js
});
