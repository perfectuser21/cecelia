/**
 * Callback result=null Fallback Tests
 * Tests that execution-callback builds a meaningful error_message when result is null.
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
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
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
      return layer.route.path === path && Object.keys(layer.route.methods)[0] === method.toLowerCase();
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

// Helper: find the UPDATE tasks call among all mockClient.query calls.
// The UPDATE tasks query is the first one containing 'UPDATE tasks' in its SQL string.
function findUpdateTasksCall(calls) {
  return calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
}

describe('execution-callback result=null fallback error_message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [{ goal_id: null }], rowCount: 1 });
  });

  it('result=null + AI Failed → errorMessage contains "callback received but result was null"', async () => {
    const res = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-null-result-1',
      status: 'AI Failed',
      result: null,
      exit_code: 2,
    });

    expect(res.statusCode).toBe(200);

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    expect(updateCall).toBeDefined();
    // $9 is index 8 in the params array
    const errorMessage = updateCall[1][8];
    expect(typeof errorMessage).toBe('string');
    expect(errorMessage).toContain('callback received but result was null');
    expect(errorMessage).toContain('task-null-result-1');
    expect(errorMessage).toContain('exit_code=2');
  });

  it('result=null + AI Failed → errorMessage contains timestamp (ISO format)', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-null-ts',
      status: 'AI Failed',
      result: null,
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    const errorMessage = updateCall[1][8];
    // ISO timestamp pattern: YYYY-MM-DDTHH:MM:SS
    expect(errorMessage).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('result=null + AI Failed + no exit_code → exit_code=N/A in errorMessage', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-null-no-exit',
      status: 'AI Failed',
      result: null,
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    const errorMessage = updateCall[1][8];
    expect(errorMessage).toContain('exit_code=N/A');
  });

  it('result=null + AI Failed + stderr → errorMessage contains stderr tail (300 chars)', async () => {
    const longStderr = 'X'.repeat(500) + 'STDERR_TAIL';
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-null-stderr',
      status: 'AI Failed',
      result: null,
      stderr: longStderr,
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    const errorMessage = updateCall[1][8];
    expect(errorMessage).toContain('STDERR_TAIL');
    expect(errorMessage).toContain('stderr:');
  });

  it('result is an object (normal case) → original logic applies, no fallback prefix', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-obj-result',
      status: 'AI Failed',
      result: { error: 'some real error message' },
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    const errorMessage = updateCall[1][8];
    expect(errorMessage).toBe('some real error message');
    expect(errorMessage).not.toContain('callback: result=null');
  });

  it('result is a string (normal case) → original logic applies', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-str-result',
      status: 'AI Failed',
      result: 'direct string error',
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    const errorMessage = updateCall[1][8];
    expect(errorMessage).toBe('direct string error');
    expect(errorMessage).not.toContain('callback: result=null');
  });

  it('status AI Done (success) → errorMessage is null (not written)', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-success',
      status: 'AI Done',
      result: { result: 'done' },
    });

    const updateCall = findUpdateTasksCall(mockClient.query.mock.calls);
    if (updateCall) {
      const errorMessage = updateCall[1][8];
      expect(errorMessage).toBeNull();
    }
  });
});
