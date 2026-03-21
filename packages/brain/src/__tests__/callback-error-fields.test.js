/**
 * Callback Error Fields Tests
 * 验证 execution-callback 在任务失败时正确写入 error_message 和 blocked_detail
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

function getUpdateParams() {
  const calls = mockClient.query.mock.calls;
  const call = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
  return call ? call[1] : null;
}

describe('execution-callback error fields (E1-E5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('decision_log')) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [{ goal_id: null }], rowCount: 1 });
    });
  });

  it('E1: AI Failed → $9 (error_message) is not null', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-fail-e1',
      run_id: 'run-e1',
      status: 'AI Failed',
      result: { result: 'CI tests failed: 3 assertions failed' },
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // $9 = errorMessage (index 8)
    expect(params[8]).not.toBeNull();
    expect(typeof params[8]).toBe('string');
    expect(params[8]).toContain('CI tests failed');
  });

  it('E2: AI Failed → $10 (blocked_detail) is valid JSON with required fields', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-fail-e2',
      run_id: 'run-e2',
      status: 'AI Failed',
      result: { stderr: 'Error: ENOENT no such file or directory' },
      exit_code: 2,
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // $10 = blockedDetail (index 9)
    expect(params[9]).not.toBeNull();
    const detail = JSON.parse(params[9]);
    expect(detail).toHaveProperty('exit_code');
    expect(detail).toHaveProperty('stderr_tail');
    expect(detail).toHaveProperty('timestamp');
    expect(detail.exit_code).toBe(2);
    expect(detail.stderr_tail).toContain('ENOENT');
  });

  it('E3: AI Done → $9 (error_message) is null (no error on success)', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-done-e3',
      run_id: 'run-e3',
      status: 'AI Done',
      result: { result: 'PR merged successfully' },
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // $9 must be null for successful tasks
    expect(params[8]).toBeNull();
    // $10 must be null for successful tasks
    expect(params[9]).toBeNull();
  });

  it('E4: AI Failed with no result → error_message falls back to status string', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-fail-e4',
      run_id: 'run-e4',
      status: 'AI Failed',
      result: null,
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    // error_message should be derived from status
    expect(params[8]).not.toBeNull();
    expect(typeof params[8]).toBe('string');
    expect(params[8].length).toBeGreaterThan(0);
  });

  it('E5: AI Failed with stderr field → stderr_tail captured in blocked_detail', async () => {
    const longStderr = 'x'.repeat(1000); // longer than 500 char cap
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-fail-e5',
      run_id: 'run-e5',
      status: 'AI Failed',
      result: { error: 'build failed' },
      stderr: longStderr,
      exit_code: 1,
    });

    const params = getUpdateParams();
    expect(params).not.toBeNull();
    const detail = JSON.parse(params[9]);
    // stderr_tail should be capped at 500 chars
    expect(detail.stderr_tail.length).toBeLessThanOrEqual(500);
    expect(detail.exit_code).toBe(1);
  });

  it('E6: UPDATE SQL must include error_message and blocked_detail columns', async () => {
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-sql-e6',
      status: 'AI Failed',
      result: { error: 'test' },
    });

    const calls = mockClient.query.mock.calls;
    const updateCall = calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks'));
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('error_message');
    expect(updateCall[0]).toContain('blocked_detail');
  });
});
