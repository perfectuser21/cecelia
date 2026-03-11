/**
 * callback-quota-exhausted.test.js
 *
 * 验证 execution-callback 收到 'AI Quota Exhausted' 时：
 * 1. newStatus 映射为 'quota_exhausted'（不是 'failed'）
 * 2. 不调用 handleTaskFailure（failure_count 不增加）
 * 3. 不触发隔离逻辑
 * 4. quota_exhausted_at 字段被写入
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock client for transactions — hoisted
const mockClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));

// Mock pool — hoisted
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(() => mockClient),
}));
vi.mock('../db.js', () => ({ default: mockPool }));

// Track handleTaskFailure calls
const handleTaskFailureMock = vi.fn();

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: handleTaskFailureMock,
  getQuarantinedTasks: vi.fn(async () => []),
  getQuarantineStats: vi.fn(async () => ({ total: 0 })),
  releaseTask: vi.fn(async () => ({})),
  quarantineTask: vi.fn(async () => ({})),
  QUARANTINE_REASONS: { REPEATED_FAILURE: 'repeated_failure' },
  REVIEW_ACTIONS: {},
  classifyFailure: vi.fn(() => ({ class: 'unknown' })),
  checkShouldQuarantine: vi.fn(() => ({ shouldQuarantine: false })),
  checkExpiredQuarantineTasks: vi.fn(async () => []),
  autoFailTimedOutTasks: vi.fn(async () => []),
  FAILURE_CLASS: {},
}));

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
  getState: vi.fn(() => ({})),
  isAllowed: vi.fn(() => true),
  recordSuccess: vi.fn(async () => {}),
  recordFailure: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  getAllStates: vi.fn(() => ({})),
  FAILURE_THRESHOLD: 3,
  OPEN_DURATION_MS: 60000,
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

describe('execution-callback quota_exhausted handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 默认 transaction mock
    mockClient.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('BEGIN')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('COMMIT')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return Promise.resolve({});
      if (typeof sql === 'string' && (sql.includes('UPDATE tasks') || sql.includes('INSERT INTO'))) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('payload FROM tasks')) {
        return Promise.resolve({ rows: [{ task_type: 'dev', payload: { failure_count: 0 } }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [{ goal_id: null }], rowCount: 0 });
    });
  });

  it('should map AI Quota Exhausted to quota_exhausted status', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-1',
      run_id: 'run-quota-1',
      status: 'AI Quota Exhausted',
      result: null,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body?.success).toBe(true);

    // 验证 UPDATE 中 status 被设为 quota_exhausted
    const updateCall = mockClient.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE tasks')
    );
    expect(updateCall).toBeDefined();
    const updateParams = updateCall[1];
    expect(updateParams[1]).toBe('quota_exhausted'); // $2 = newStatus
  });

  it('should NOT call handleTaskFailure for quota_exhausted', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-2',
      run_id: 'run-quota-2',
      status: 'AI Quota Exhausted',
      result: null,
    });

    // handleTaskFailure 绝对不能被调用
    expect(handleTaskFailureMock).not.toHaveBeenCalled();
  });

  it('should set quota_exhausted_at ($11=true) in DB update', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-3',
      run_id: 'run-quota-3',
      status: 'AI Quota Exhausted',
      result: null,
    });

    const updateCall = mockClient.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('quota_exhausted_at')
    );
    expect(updateCall).toBeDefined();
    const updateParams = updateCall[1];
    // $11 = isQuotaExhausted = true
    expect(updateParams[10]).toBe(true);
  });

  it('should still call handleTaskFailure for AI Failed (regression)', async () => {
    handleTaskFailureMock.mockResolvedValue({ quarantined: false, failure_count: 1 });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-failed-1',
      run_id: 'run-failed-1',
      status: 'AI Failed',
      result: 'some error',
    });

    // 普通 AI Failed 必须调用 handleTaskFailure
    expect(handleTaskFailureMock).toHaveBeenCalledWith('task-failed-1');
  });
});
