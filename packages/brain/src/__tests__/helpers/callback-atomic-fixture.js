import { afterEach, beforeEach } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const boundary = vi.hoisted(() => ({ forbidden: [],
  deny(kind) { this.forbidden.push(kind); throw Error('forbidden ' + kind); },
}));
// Mock client for transactions — hoisted 确保 routes.js 加载时获得同一实例
const mockClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));

// Mock pool — hoisted 确保 routes.js 加载时获得同一实例
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(() => mockClient),
}));
vi.mock('../../db.js', () => ({ default: mockPool }));

// Mock executor
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn(() => boundary.deny('executor trigger')),
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));

// Mock other imports that routes.js needs
vi.mock('../../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn(),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(),
  LOCATION_MAP: {},
}));
vi.mock('../../okr-tick.js', () => ({
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
vi.mock('../../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn(),
  getDailyReports: vi.fn(),
}));
vi.mock('../../intent.js', () => ({
  parseIntent: vi.fn(),
  parseAndCreate: vi.fn(),
  INTENT_TYPES: {},
  INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(),
  classifyIntent: vi.fn(),
  getSuggestedAction: vi.fn(),
}));
vi.mock('../../templates.js', () => ({
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
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  getDecisionHistory: vi.fn(),
  rollbackDecision: vi.fn(),
}));
vi.mock('../../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
}));
vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn(),
  getEventCounts: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('../../circuit-breaker.js', () => ({
  getState: vi.fn(),
  reset: vi.fn(),
  getAllStates: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock('../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(async () => {}),
  notifyTaskFailed: vi.fn(async () => {}),
}));

// 事务后依赖均record-only；不把这些替身当模型/通知/接棒业务验收。
vi.mock('../../llm-caller.js', () => ({ callLLM: () => boundary.deny('LLM') }));
vi.mock('../../invocations/runtime.js', () => ({ guardInvocationCallback: vi.fn(async () => {}) }));
vi.mock('../../lib/headed-task-owner.js', () => ({ assertAutomaticTaskOwner: vi.fn(async () => {}) }));
vi.mock('../../workflow-authoring/task-guard.js', () => ({
  authoringMutationError: () => null, assertAuthoringCompletion: vi.fn(async () => {}),
}));
vi.mock('../../lib/task-run.js', () => ({ recordRunFromCallback: vi.fn(async () => {}) }));
vi.mock('../../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../../lib/task-terminal.js', () => ({ afterTerminalTransition: vi.fn(async () => {}) }));
vi.mock('../../thalamus.js', () => ({
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed' },
  processEvent: vi.fn(async () => ({ level: 0, actions: [{ type: 'fallback_to_tick' }] })),
}));
vi.mock('../../decision-executor.js', () => ({ executeDecision: () => boundary.deny('decision execution') }));
vi.mock('../../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn(async () => {}) }));
vi.mock('../../events/taskEvents.js', () => ({ publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn() }));
vi.mock('../../platform-utils.js', () => ({ getAvailableMemoryMB: vi.fn(() => 1024) }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn(async () => {}) }));
vi.mock('../../quarantine.js', () => ({ handleTaskFailure: vi.fn(async () => ({ quarantined: false })) }));
vi.mock('../../lib/callback-postprocess.js', () => ({
  serialUnlockNext: vi.fn(async () => {}), writeReviewResult: vi.fn(async () => {}), promoteRegressionOnHarnessMerged: vi.fn(async () => {}),
}));
vi.mock('../../lib/cascade-writeback.js', () => ({ writeCascadeCellStatuses: vi.fn(async () => {}) }));
vi.mock('../../lib/internal-service-auth.js', () => ({ internalServiceHeaders: () => ({}) }));
vi.mock('../../lib/harness-report-writeback.js', () => ({ finalizeHarnessReportFeature: vi.fn(async () => {}) }));
vi.mock('../../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn(async () => {}) }));
vi.mock('../../code-review-trigger.js', () => ({ checkAndCreateCodeReviewTrigger: vi.fn(async () => {}) }));
vi.mock('../../routes/shared.js', () => ({ resolveRelatedFailureMemories: vi.fn(async () => {}) }));
vi.mock('../../zenithjoy-db.js', () => ({ getZenithjoyPool: () => ({ query: () => boundary.deny('business DB') }) }));
vi.mock('../../execution.js', () => ({ readVerdictWithRetry: vi.fn(), persistVerdictTimeout: vi.fn(),
  isBridgeSessionCrash: () => false, handleEvaluateSessionCrash: vi.fn() }));
vi.mock('../../watchdog.js', () => ({ cleanupMetrics: vi.fn(async () => {}) }));
vi.mock('../../lib/safe-sync-command.js', () => ({ runSyncCommand: () => boundary.deny('sync command') }));
vi.mock('../../anchor-check.js', () => ({ checkAnchor: vi.fn() }));
vi.mock('child_process', () => ({
  exec: () => boundary.deny('exec'), execSync: () => boundary.deny('execSync'),
  spawn: () => boundary.deny('spawn'), execFileSync: () => boundary.deny('execFileSync'),
}));

import router from '../../routes/execution.js';
beforeEach(() => {
  boundary.forbidden.length = 0;
  vi.stubEnv('CECELIA_INTERNAL_TOKEN', 'owned-callback-token');
  vi.stubGlobal('fetch', () => boundary.deny('fetch'));
});
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  if (boundary.forbidden.length) throw Error('callback foreign effects: ' + boundary.forbidden.join(','));
});
export async function mockReqRes(method, routePath, body = {}) {
  if (method !== 'POST' || routePath !== '/execution-callback') throw Error('unexpected test route');
  const app = express(); app.use(express.json()); app.use('/api/brain', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await request(server).post('/api/brain' + routePath)
      .set('X-Internal-Token', 'owned-callback-token').send(body);
    return { statusCode: response.status, body: response.body };
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
export function transactionPhases() {
  return mockClient.query.mock.calls.map(([sql]) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return sql;
    if (sql.includes('UPDATE tasks')) return 'UPDATE';
    if (sql.includes('INSERT INTO decision_log')) return 'INSERT';
    return 'UNEXPECTED';
  });
}
export { mockClient, mockPool };
