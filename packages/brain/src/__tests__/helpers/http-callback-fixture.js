import { vi, expect } from 'vitest';

// ── Mocks must be declared before imports (Vitest hoisting) ──

const callbackPool = vi.hoisted(() => ({query:vi.fn(),connect:vi.fn()}));
vi.mock('../../db.js', () => ({default:callbackPool}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(''),
  spawn: vi.fn(),
  spawnSync: vi.fn().mockReturnValue({ status: 0, stdout: '[]', stderr: '' }),
}));

vi.mock('../../tick.js', () => ({
  runTickSafe: vi.fn().mockResolvedValue({ actions_taken: [] }),
  getTickStatus: vi.fn().mockReturnValue({ running: false }),
}));

vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue(null),
  EVENT_TYPES: { TASK_COMPLETED: 'TASK_COMPLETED', TASK_FAILED: 'TASK_FAILED' },
}));

vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));

vi.mock('../../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));

vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../../event-bus.js', () => ({
  emit: vi.fn(),
}));

vi.mock('../../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));

vi.mock('../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(2048),
}));

vi.mock('../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
}));

vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
}));

vi.mock('../../lib/review-task-types.js', () => ({
  REVIEW_TASK_TYPES: ['harness_contract_review', 'code_review'],
}));

vi.mock('../../lib/callback-postprocess.js', () => ({
  serialUnlockNext: vi.fn().mockResolvedValue(null),
  writeReviewResult: vi.fn().mockResolvedValue(null),
  promoteRegressionOnHarnessMerged: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/cascade-writeback.js', () => ({
  writeCascadeCellStatuses: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/internal-service-auth.js', () => ({
  internalServiceHeaders: vi.fn().mockReturnValue({}),
}));

vi.mock('../../lib/harness-report-writeback.js', () => ({
  finalizeHarnessReportFeature: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../dep-cascade.js', () => ({
  propagateDependencyFailure: vi.fn().mockResolvedValue({ affected: [] }),
  recoverDependencyChain: vi.fn().mockResolvedValue({ recovered: [] }),
}));

vi.mock('../../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../zenithjoy-db.js', () => ({
  getZenithjoyPool: vi.fn().mockReturnValue(null),
}));

vi.mock('../../execution.js', () => ({
  readVerdictWithRetry: vi.fn().mockResolvedValue(null),
  persistVerdictTimeout: vi.fn().mockResolvedValue(null),
  isBridgeSessionCrash: vi.fn().mockReturnValue(false),
  handleEvaluateSessionCrash: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/retry-policy.js', () => ({
  isTransientClass: vi.fn().mockReturnValue(false),
}));

vi.mock('../../anchor-check.js', () => ({
  checkAnchor: vi.fn().mockResolvedValue({ ok: true }),
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

vi.mock('../../ci-diagnostics.js', () => ({
  diagnoseCiFailure: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../dev-failure-classifier.js', () => ({
  classifyDevFailure: vi.fn().mockReturnValue({ class: 'other', retryable: false }),
}));

vi.mock('../../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../actions.js', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'new-harness-task-001' }),
}));


vi.mock('../../lib/task-run.js', () => ({ recordRunFromCallback: vi.fn() }));
vi.mock('../../lib/task-terminal.js', () => ({ afterTerminalTransition: vi.fn() }));
vi.mock('../../invocations/runtime.js', () => ({ guardInvocationCallback: vi.fn() }));
vi.mock('../../workflow-authoring/task-guard.js', () => ({authoringMutationError: vi.fn(), assertAuthoringCompletion: vi.fn()}));
vi.mock('../../lib/headed-task-owner.js', () => ({assertAutomaticTaskOwner: vi.fn()}));
import express from 'express';
import request from 'supertest';
export const pool = callbackPool;
const forbiddenFetch=vi.fn(async()=>{throw Error('external fetch prohibited in callback fixture');});
vi.stubGlobal('fetch',forbiddenFetch);
export async function callbackFixture(overrides = {}) {
  const task = {id:'11111111-1111-4111-8111-111111111111',task_type:'research',status:'in_progress',payload:{},retry_count:0, ...overrides};
  const client = {query:vi.fn(async sql => ({rows:sql.includes('UPDATE tasks')?[{...task}]:[],rowCount:1})),release:vi.fn()};
  pool.connect.mockResolvedValue(client);
  pool.query.mockImplementation(async sql => {
    if (/SELECT .*FROM tasks|SELECT[\s\S]*FROM tasks/.test(sql)) return {rows:[task],rowCount:1};
    if (sql.includes('INSERT INTO callback_queue')) return {rows:[{id:'queue-fixture'}],rowCount:1};
    return {rows:[],rowCount:1};
  });
  const router = (await import('../../routes/execution.js')).default;
  const app=express().use(express.json()).use('/api/brain',router);
  const invoke=async body=>{
    const response=await request(app).post('/api/brain/execution-callback').send({task_id:task.id,status:'AI Done',result:{summary:'fixture'},...body});
    expect(forbiddenFetch).not.toHaveBeenCalled();
    return response;
  };
  return {task,client,invoke};
}

// Only shorten the callback's fixed 5s refill cooldown; execute its real branch.
const nativeTimeout=globalThis.setTimeout;
vi.spyOn(globalThis,'setTimeout').mockImplementation((callback,delay,...args)=>nativeTimeout(callback,delay===5000?0:delay,...args));
