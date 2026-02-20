/**
 * Callback Atomic Tests
 * Tests that execution-callback uses DB transactions for atomic updates
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Mock executor
vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));

// Mock other imports that routes.js needs
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
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
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

describe('execution-callback atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('should use BEGIN/COMMIT transaction for callback processing', async () => {
    // Mock the pool.query for progress rollup (after transaction)
    mockPool.query.mockResolvedValue({ rows: [{ goal_id: null }], rowCount: 1 });

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-tx-1',
      run_id: 'run-tx-1',
      status: 'AI Done',
      result: { result: 'success' },
      duration_ms: 5000,
      iterations: 1,
    });

    expect(result.statusCode).toBe(200);

    // Verify transaction pattern: BEGIN → UPDATE → INSERT → COMMIT
    // Note: after the callback's transaction, thalamus/decision-executor may run
    // additional transactions on the same mockClient, so we check that COMMIT
    // appears after BEGIN (not necessarily as the very last call).
    const clientCalls = mockClient.query.mock.calls;
    expect(clientCalls[0][0]).toBe('BEGIN');
    const commitCalls = clientCalls.filter(c => typeof c[0] === 'string' && c[0] === 'COMMIT');
    expect(commitCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should ROLLBACK on transaction error', async () => {
    // Make the UPDATE inside transaction fail
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('DB write error')); // UPDATE fails

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-tx-fail',
      run_id: 'run-tx-fail',
      status: 'AI Done',
    });

    expect(result.statusCode).toBe(500);

    // Verify ROLLBACK was called
    const rollbackCalls = mockClient.query.mock.calls.filter(c => c[0] === 'ROLLBACK');
    expect(rollbackCalls.length).toBe(1);
  });

  it('should always release client even on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockRejectedValueOnce(new Error('fail'));

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-release',
      status: 'AI Done',
    });

    expect(mockClient.release).toHaveBeenCalled();
  });

  it('UPDATE tasks should use boolean $6 for completed_at, not reuse $2 in CASE WHEN', async () => {
    // Regression test: "inconsistent types deduced for parameter $2 (text vs character varying)"
    // The fix extracts isCompleted as a separate boolean param ($6) to avoid $2 type ambiguity.
    mockPool.query.mockResolvedValue({ rows: [{ goal_id: null }], rowCount: 1 });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-sql-type',
      run_id: 'run-sql-type',
      status: 'AI Done',
      result: { result: 'ok' },
      duration_ms: 1000,
      iterations: 1,
    });

    // Find the UPDATE tasks call (after BEGIN)
    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    // Should have 6 params: [task_id, newStatus, lastRunResult, status, pr_url, isCompleted]
    const params = updateCall[1];
    expect(params).toHaveLength(6);

    // $6 (isCompleted) must be a boolean true for 'AI Done'
    expect(typeof params[5]).toBe('boolean');
    expect(params[5]).toBe(true);

    // $2 (newStatus) must be 'completed'
    expect(params[1]).toBe('completed');
  });

  it('isCompleted should be false for AI Failed status', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ goal_id: null }], rowCount: 1 });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-failed-type',
      run_id: 'run-failed-type',
      status: 'AI Failed',
      duration_ms: 500,
      iterations: 1,
    });

    const clientCalls = mockClient.query.mock.calls;
    const updateCall = clientCalls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();

    const params = updateCall[1];
    expect(params).toHaveLength(6);
    // $6 must be false for failed tasks
    expect(params[5]).toBe(false);
    expect(params[1]).toBe('failed');
  });
});
