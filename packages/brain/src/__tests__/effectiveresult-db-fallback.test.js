/**
 * effectiveResult 第三层兜底测试
 *
 * 场景：execution-callback 全字段皆空（result/exit_code/stderr/failure_class 均为 null）
 * 期望：从 DB 查询 error_message 构造 effectiveResult = { error, source: 'db_fallback' }
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
}));
vi.mock('../dev-failure-classifier.js', () => ({
  classifyDevFailure: vi.fn(() => ({ class: 'unknown', retryable: false, reason: 'test' })),
}));
vi.mock('../ci-diagnostics.js', () => ({
  diagnoseCiFailure: vi.fn(async () => null),
}));

let router;
let processExecutionAutoLearning;

beforeAll(async () => {
  vi.resetModules();
  const routesMod = await import('../routes.js');
  router = routesMod.default;
  const learningMod = await import('../auto-learning.js');
  processExecutionAutoLearning = learningMod.processExecutionAutoLearning;
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

describe('effectiveResult 第三层兜底 (db_fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('全空 callback → processExecutionAutoLearning 收到 source=db_fallback', async () => {
    const dbErrMsg = 'callback received with no diagnostic data (task_id: task-db-fallback-1)';

    // pool.query: 通用返回空，SELECT error_message 时返回有值
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT error_message')) {
        return Promise.resolve({ rows: [{ error_message: dbErrMsg }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-db-fallback-1',
      status: 'AI Failed',
      // result, exit_code, stderr, failure_class 全部缺失
    });

    expect(res.statusCode).toBe(200);

    // 验证 processExecutionAutoLearning 被调用且 effectiveResult.source === 'db_fallback'
    expect(processExecutionAutoLearning).toHaveBeenCalled();
    const callArgs = processExecutionAutoLearning.mock.calls[0];
    const passedResult = callArgs[2]; // third param is effectiveResult
    expect(passedResult).not.toBeNull();
    expect(passedResult.source).toBe('db_fallback');
    expect(passedResult.error).toBe(dbErrMsg);
  });

  it('有 exit_code 时走 synthesized_from_callback，不触发 db_fallback', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-with-exit-code',
      status: 'AI Failed',
      exit_code: 1,
    });

    expect(processExecutionAutoLearning).toHaveBeenCalled();
    const callArgs = processExecutionAutoLearning.mock.calls[0];
    const passedResult = callArgs[2];
    expect(passedResult).not.toBeNull();
    expect(passedResult.source).toBe('synthesized_from_callback');
  });

  it('DB error_message 为空时 effectiveResult stays null', async () => {
    // pool.query 对 SELECT error_message 返回空行
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT error_message')) {
        return Promise.resolve({ rows: [{ error_message: null }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-db-empty-msg',
      status: 'AI Failed',
    });

    expect(processExecutionAutoLearning).toHaveBeenCalled();
    const callArgs = processExecutionAutoLearning.mock.calls[0];
    const passedResult = callArgs[2];
    // error_message 为 null，不构造对象，effectiveResult 应保持 null
    expect(passedResult).toBeNull();
  });

  it('DB 查询异常时 effectiveResult 保持 null，流程继续', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('SELECT error_message')) {
        return Promise.reject(new Error('DB connection error'));
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const res = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-db-query-fail',
      status: 'AI Failed',
    });

    // 不应报 500，DB 查询失败是 non-fatal
    expect(res.statusCode).toBe(200);

    expect(processExecutionAutoLearning).toHaveBeenCalled();
    const callArgs = processExecutionAutoLearning.mock.calls[0];
    const passedResult = callArgs[2];
    expect(passedResult).toBeNull();
  });

  it('result 已有值时直接使用 result，不触发 db_fallback', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-has-result',
      status: 'AI Failed',
      result: { error: 'real error', source: 'agent' },
    });

    expect(processExecutionAutoLearning).toHaveBeenCalled();
    const callArgs = processExecutionAutoLearning.mock.calls[0];
    const passedResult = callArgs[2];
    expect(passedResult).not.toBeNull();
    expect(passedResult.source).toBe('agent');
  });
});
