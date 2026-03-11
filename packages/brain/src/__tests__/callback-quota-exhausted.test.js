/**
 * callback-quota-exhausted.test.js
 *
 * 验证 execution-callback 收到 'AI Quota Exhausted' 时：
 * 1. 返回 200，任务状态设为 quota_exhausted
 * 2. handleTaskFailure 不被调用（不增加 failure_count）
 * 3. cbFailure 不被调用（不计入熔断）
 * 4. DB UPDATE 包含 quota_exhausted_at 字段
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const cbFailureMock = vi.fn();
const cbSuccessMock = vi.fn();
const handleTaskFailureMock = vi.fn(async () => ({ quarantined: false, failure_count: 0 }));

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
  setBillingPause: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  clearBillingPause: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: handleTaskFailureMock,
  getQuarantinedTasks: vi.fn(async () => []),
  getQuarantineStats: vi.fn(async () => ({ total: 0 })),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  checkExpiredQuarantineTasks: vi.fn(async () => []),
  QUARANTINE_REASONS: { REPEATED_FAILURE: 'repeated_failure' },
  REVIEW_ACTIONS: {},
  classifyFailure: vi.fn(() => ({ class: 'unknown' })),
  FAILURE_CLASS: { BILLING_CAP: 'billing_cap', RATE_LIMIT: 'rate_limit' },
  parseResetTime: vi.fn(() => null),
}));

vi.mock('../actions.js', () => ({ createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(), updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(), batchUpdateTasks: vi.fn() }));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('../tick.js', () => ({ getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(), executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })), routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn(), LOCATION_MAP: {} }));
vi.mock('../okr-tick.js', () => ({ executeOkrTick: vi.fn(), runOkrTickSafe: vi.fn(), startOkrTickLoop: vi.fn(), stopOkrTickLoop: vi.fn(), getOkrTickStatus: vi.fn(), addQuestionToGoal: vi.fn(), answerQuestionForGoal: vi.fn(), getPendingQuestions: vi.fn(), OKR_STATUS: {} }));
vi.mock('../nightly-tick.js', () => ({ executeNightlyAlignment: vi.fn(), runNightlyAlignmentSafe: vi.fn(), startNightlyScheduler: vi.fn(), stopNightlyScheduler: vi.fn(), getNightlyTickStatus: vi.fn(), getDailyReports: vi.fn() }));
vi.mock('../intent.js', () => ({ parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {}, extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn() }));
vi.mock('../templates.js', () => ({ generatePrdFromTask: vi.fn(), generatePrdFromGoalKR: vi.fn(), generateTrdFromGoal: vi.fn(), generateTrdFromGoalKR: vi.fn(), validatePrd: vi.fn(), validateTrd: vi.fn(), prdToJson: vi.fn(), trdToJson: vi.fn(), PRD_TYPE_MAP: {} }));
vi.mock('../decision.js', () => ({ compareGoalProgress: vi.fn(), generateDecision: vi.fn(), executeDecision: vi.fn(), getDecisionHistory: vi.fn(), rollbackDecision: vi.fn() }));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn(), getPlanStatus: vi.fn(), handlePlanInput: vi.fn() }));
vi.mock('../event-bus.js', () => ({ ensureEventsTable: vi.fn(), queryEvents: vi.fn(), getEventCounts: vi.fn(), emit: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: cbSuccessMock, recordFailure: cbFailureMock, reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../account-usage.js', () => ({ markSpendingCap: vi.fn(), isSpendingCapped: vi.fn(() => false), selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'sonnet' })), selectBestAccountForHaiku: vi.fn(async () => 'account1'), getAccountUsage: vi.fn(async () => ({})), getSpendingCapStatus: vi.fn(() => []), isAllAccountsSpendingCapped: vi.fn(() => false), loadSpendingCapsFromDB: vi.fn(async () => {}) }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}) }));

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

function setupDefaultMocks() {
  mockClient.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('BEGIN')) return Promise.resolve({});
    if (typeof sql === 'string' && sql.includes('COMMIT')) return Promise.resolve({});
    if (typeof sql === 'string' && sql.includes('ROLLBACK')) return Promise.resolve({});
    if (typeof sql === 'string' && (sql.includes('UPDATE tasks') && !sql.includes('decision_log') || sql.includes('INSERT INTO decision_log'))) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockPool.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('payload FROM tasks')) {
      return Promise.resolve({ rows: [{ task_type: 'dev', payload: {} }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [{ goal_id: null }], rowCount: 0 });
  });
}

describe('execution-callback: quota_exhausted 状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it('应接受 AI Quota Exhausted 并返回 200', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-1',
      run_id: 'run-quota-1',
      status: 'AI Quota Exhausted',
      result: { result: 'quota exhausted' },
    });
    expect(result.statusCode).toBe(200);
  });

  it('不应调用 handleTaskFailure（不增加 failure_count）', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-2',
      run_id: 'run-quota-2',
      status: 'AI Quota Exhausted',
      result: null,
    });
    expect(handleTaskFailureMock).not.toHaveBeenCalled();
  });

  it('不应调用 cbFailure（不计入熔断）', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-3',
      run_id: 'run-quota-3',
      status: 'AI Quota Exhausted',
      result: { result: 'quota limit' },
    });
    expect(cbFailureMock).not.toHaveBeenCalled();
  });

  it('DB UPDATE 应包含 quota_exhausted_at 字段且 newStatus=quota_exhausted', async () => {
    let capturedSql = null;
    let capturedParams = null;
    mockClient.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('UPDATE tasks') && !sql.includes('decision_log')) {
        capturedSql = sql;
        capturedParams = params;
      }
      if (typeof sql === 'string' && sql.includes('BEGIN')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('COMMIT')) return Promise.resolve({});
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return Promise.resolve({});
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-quota-4',
      run_id: 'run-quota-4',
      status: 'AI Quota Exhausted',
      result: null,
    });

    expect(capturedSql).toContain('quota_exhausted_at');
    expect(capturedParams[1]).toBe('quota_exhausted');
    // $11 (index 10) is isQuotaExhausted = true
    expect(capturedParams[10]).toBe(true);
  });
});
