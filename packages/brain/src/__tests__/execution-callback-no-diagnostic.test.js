/**
 * execution-callback 全字段皆空兜底测试
 *
 * 当 result/exit_code/stderr/failure_class 全部缺失时，
 * 应注入 failure_class='no_diagnostic' 和 error_message 到 tasks 表
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock client for transactions
const mockClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));

// Mock pool
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
  triggerCeceliaRun: vi.fn(async () => ({ success: true })),
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
  drainTick: vi.fn(),
  getDrainStatus: vi.fn(),
  cancelDrain: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
  getStartupErrors: vi.fn(() => []),
  check48hReport: vi.fn(async () => null),
}));
vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
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
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));
vi.mock('../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn(),
  getEventCounts: vi.fn(),
  emit: vi.fn(async () => {}),
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

// Failed path specific mocks
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
  classifyFailure: vi.fn(() => ({
    class: 'unknown',
    pattern: null,
    retry_strategy: null,
  })),
}));
vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn(async () => null),
}));
vi.mock('../dep-cascade.js', () => ({
  propagateDependencyFailure: vi.fn(async () => ({ affected: [] })),
  recoverDependencyChain: vi.fn(async () => ({ recovered: [] })),
}));
vi.mock('../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn(async () => {}),
}));
vi.mock('../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn(async () => {}),
}));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({ level: 0, actions: [{ type: 'fallback_to_tick' }] })),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
  ACTION_WHITELIST: {},
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(async () => {}),
  getPendingActions: vi.fn(async () => []),
  approvePendingAction: vi.fn(async () => {}),
  rejectPendingAction: vi.fn(async () => {}),
  addProposalComment: vi.fn(async () => {}),
  selectProposalOption: vi.fn(async () => {}),
  expireStaleProposals: vi.fn(async () => {}),
}));
vi.mock('../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(async () => {}),
}));
vi.mock('../watchdog.js', () => ({
  cleanupMetrics: vi.fn(async () => {}),
  getWatchdogMetrics: vi.fn(async () => ({})),
}));
vi.mock('../progress-ledger.js', () => ({
  recordProgressStep: vi.fn(async () => {}),
}));
vi.mock('../websocket.js', () => ({
  default: { emit: vi.fn() },
  WS_EVENTS: {},
}));
vi.mock('../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn(() => ({ level: 0 })),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  evaluateAlertness: vi.fn(async () => ({ level: 0 })),
  ALERTNESS_LEVELS: {},
  LEVEL_NAMES: {},
}));
vi.mock('../alerting.js', () => ({
  raise: vi.fn(async () => {}),
}));
vi.mock('../account-usage.js', () => ({
  getAccountUsage: vi.fn(async () => ({})),
  selectBestAccount: vi.fn(async () => null),
  markSpendingCap: vi.fn(),
}));
vi.mock('../stats.js', () => ({
  getMonthlyPRCount: vi.fn(async () => 0),
  getMonthlyPRsByKR: vi.fn(async () => []),
  getPRSuccessRate: vi.fn(async () => 0),
  getPRTrend: vi.fn(async () => []),
}));
vi.mock('../task-cleanup.js', () => ({
  getCleanupStats: vi.fn(async () => ({})),
  runTaskCleanup: vi.fn(async () => ({})),
  getCleanupAuditLog: vi.fn(async () => []),
}));
vi.mock('../task-weight.js', () => ({
  getTaskWeights: vi.fn(async () => ({})),
}));
vi.mock('../model-profile.js', () => ({
  loadActiveProfile: vi.fn(async () => ({})),
  getActiveProfile: vi.fn(() => null),
  switchProfile: vi.fn(async () => ({})),
  listProfiles: vi.fn(async () => []),
  updateAgentModel: vi.fn(async () => ({})),
  batchUpdateAgentModels: vi.fn(async () => ({})),
  updateAgentCascade: vi.fn(async () => ({})),
}));
vi.mock('../user-profile.js', () => ({
  loadUserProfile: vi.fn(async () => null),
  upsertUserProfile: vi.fn(async () => ({})),
}));
vi.mock('../orchestrator-chat.js', () => ({
  handleChat: vi.fn(async () => ({})),
  handleChatStream: vi.fn(async () => ({})),
}));
vi.mock('../orchestrator-realtime.js', () => ({
  getRealtimeConfig: vi.fn(async () => ({})),
  handleRealtimeTool: vi.fn(async () => ({})),
}));
vi.mock('../proposal.js', () => ({
  createProposal: vi.fn(async () => ({})),
  approveProposal: vi.fn(async () => ({})),
  rollbackProposal: vi.fn(async () => ({})),
  rejectProposal: vi.fn(async () => ({})),
  getProposal: vi.fn(async () => null),
  listProposals: vi.fn(async () => []),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(async () => ({})),
  callLLMStream: vi.fn(async () => ({})),
}));
vi.mock('../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(() => true),
  extractPrInfo: vi.fn(() => ({})),
  handlePrMerged: vi.fn(async () => ({})),
}));
vi.mock('../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn(async () => ({})),
}));
vi.mock('../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn(() => 8192),
  getBrainRssMB: vi.fn(() => 500),
  evaluateMemoryHealth: vi.fn(() => ({
    brain_memory_ok: true, system_memory_ok: true, action: 'proceed',
    reason: 'mock', brain_rss_mb: 500, system_available_mb: 8192,
    system_threshold_mb: 600, brain_rss_danger_mb: 1500, brain_rss_warn_mb: 1000,
  })),
}));
vi.mock('../dev-failure-classifier.js', () => ({
  classifyDevFailure: vi.fn(() => ({ class: 'unknown', retryable: false, reason: 'test' })),
}));
vi.mock('../ci-diagnostics.js', () => ({
  diagnoseCiFailure: vi.fn(async () => null),
}));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../routes.js');
  router = mod.default;
});

// Helper: simulate express request/response
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

describe('execution-callback 全字段皆空兜底 (no_diagnostic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('全字段皆空时应注入 failure_class=no_diagnostic', async () => {
    // 仅提供 task_id + status=AI Failed，不带任何诊断字段
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-no-diag-1',
      status: 'AI Failed',
      // result: undefined
      // exit_code: undefined
      // stderr: undefined
      // failure_class: undefined
    });

    expect(result.statusCode).toBe(200);

    // 验证 pool.query 中有 no_diagnostic 注入 UPDATE
    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    expect(noDiagCall).toBeDefined();

    // 验证 error_message 参数包含 "no diagnostic data"
    const params = noDiagCall[1];
    expect(params[1]).toMatch(/no diagnostic data/);
    expect(params[1]).toContain('task-no-diag-1');

    // 验证 failure_class payload 参数
    const payloadJson = JSON.parse(params[2]);
    expect(payloadJson.failure_class).toBe('no_diagnostic');
  });

  it('有 result 时不应触发兜底', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-with-result',
      status: 'AI Failed',
      result: { error: 'some error' },
    });

    expect(result.statusCode).toBe(200);

    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    // should not inject no_diagnostic when result is present
    expect(noDiagCall).toBeUndefined();
  });

  it('有 exit_code 时不应触发兜底', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-with-exitcode',
      status: 'AI Failed',
      exit_code: 1,
    });

    expect(result.statusCode).toBe(200);

    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    expect(noDiagCall).toBeUndefined();
  });

  it('有 stderr 时不应触发兜底', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-with-stderr',
      status: 'AI Failed',
      stderr: 'some error output',
    });

    expect(result.statusCode).toBe(200);

    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    expect(noDiagCall).toBeUndefined();
  });

  it('有 failure_class 时不应触发兜底', async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-with-fc',
      status: 'AI Failed',
      failure_class: 'BILLING_CAP',
    });

    expect(result.statusCode).toBe(200);

    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    expect(noDiagCall).toBeUndefined();
  });

  it('status=AI Done 时不应触发兜底（非失败任务）', { timeout: 10000 }, async () => {
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-completed',
      status: 'AI Done',
    });

    expect(result.statusCode).toBe(200);

    const poolCalls = mockPool.query.mock.calls;
    const noDiagCall = poolCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('no_diagnostic')
    );
    expect(noDiagCall).toBeUndefined();
  });
});
