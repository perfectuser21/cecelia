/**
 * POST /api/brain/learnings-received 端点测试
 *
 * 验证：
 * - issues_found → createTask（fix task，任务线）
 * - next_steps_suggested → learnings 表（成长线）
 * - 空内容时正常返回
 * - 部分失败时不影响其他条目
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock ──────────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
const mockCreateTask = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

// 其他依赖 mock（routes.js 有大量 import）
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(),
  routeTask: vi.fn(),
  drainTick: vi.fn(),
  getDrainStatus: vi.fn(),
  cancelDrain: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
  getStartupErrors: vi.fn(() => []),
  dispatchNextTask: vi.fn(),
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {
    LEARNINGS_RECEIVED: 'learnings_received',
    TASK_COMPLETED: 'task_completed',
    TASK_FAILED: 'task_failed',
    USER_MESSAGE: 'user_message',
    TICK: 'tick',
  },
  ACTION_WHITELIST: {},
  validateDecision: vi.fn(() => ({ valid: true, errors: [] })),
  hasDangerousActions: vi.fn(() => false),
  quickRoute: vi.fn(),
  analyzeEvent: vi.fn(),
  createFallbackDecision: vi.fn(),
  recordRoutingDecision: vi.fn(),
  parseDecisionFromResponse: vi.fn(),
  classifyLLMError: vi.fn(),
  recordLLMError: vi.fn(),
  LLM_ERROR_TYPE: {},
  calculateCost: vi.fn(),
  recordTokenUsage: vi.fn(),
  MODEL_PRICING: {},
  getRecentLearnings: vi.fn(() => []),
  extractMemoryQuery: vi.fn(),
  buildMemoryBlock: vi.fn(),
  recordMemoryRetrieval: vi.fn(),
  callThalamusLLM: vi.fn(),
  callThalamLLM: vi.fn(),
  _resetThalamusMinimaxKey: vi.fn(),
}));

// 其余大量 import 的 mock
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn(() => []), LOCATION_MAP: {} }));
vi.mock('../intent.js', () => ({ parseIntent: vi.fn(), parseAndCreate: vi.fn(), INTENT_TYPES: {}, INTENT_ACTION_MAP: {}, extractEntities: vi.fn(), classifyIntent: vi.fn(), getSuggestedAction: vi.fn() }));
vi.mock('../templates.js', () => ({ generatePrdFromTask: vi.fn(), generatePrdFromGoalKR: vi.fn(), generateTrdFromGoal: vi.fn(), generateTrdFromGoalKR: vi.fn(), validatePrd: vi.fn(), validateTrd: vi.fn(), prdToJson: vi.fn(), trdToJson: vi.fn(), PRD_TYPE_MAP: {} }));
vi.mock('../decision.js', () => ({ compareGoalProgress: vi.fn(), generateDecision: vi.fn(), executeDecision: vi.fn(), rollbackDecision: vi.fn() }));
vi.mock('../planner.js', () => ({ planNextTask: vi.fn(), getPlanStatus: vi.fn(), handlePlanInput: vi.fn(), getGlobalState: vi.fn(), selectTopAreas: vi.fn(), selectActiveInitiativeForArea: vi.fn(), ACTIVE_AREA_COUNT: 3 }));
vi.mock('../event-bus.js', () => ({ ensureEventsTable: vi.fn(), queryEvents: vi.fn(), getEventCounts: vi.fn(), emit: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(), reset: vi.fn(), getAllStates: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() }));
vi.mock('../alertness/index.js', () => ({ getCurrentAlertness: vi.fn(), setManualOverride: vi.fn(), clearManualOverride: vi.fn(), evaluateAlertness: vi.fn(), ALERTNESS_LEVELS: {}, LEVEL_NAMES: {} }));
vi.mock('../quarantine.js', () => ({ handleTaskFailure: vi.fn(), getQuarantinedTasks: vi.fn(), getQuarantineStats: vi.fn(), releaseTask: vi.fn(), quarantineTask: vi.fn(), QUARANTINE_REASONS: {}, REVIEW_ACTIONS: {}, classifyFailure: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishTaskCreated: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn() }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(), notifyTaskFailed: vi.fn() }));
vi.mock('../account-usage.js', () => ({ getAccountUsage: vi.fn(), selectBestAccount: vi.fn() }));
vi.mock('../websocket.js', () => ({ default: { broadcast: vi.fn() }, WS_EVENTS: {}, broadcast: vi.fn() }));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn(), getPendingActions: vi.fn(), approvePendingAction: vi.fn(), rejectPendingAction: vi.fn(), addProposalComment: vi.fn(), selectProposalOption: vi.fn(), expireStaleProposals: vi.fn() }));
vi.mock('../proposal.js', () => ({ createProposal: vi.fn(), approveProposal: vi.fn(), rollbackProposal: vi.fn(), rejectProposal: vi.fn(), getProposal: vi.fn(), listProposals: vi.fn() }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
vi.mock('../orchestrator-chat.js', () => ({ handleChat: vi.fn(), handleChatStream: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn() }));
vi.mock('../memory-retriever.js', () => ({ buildMemoryContext: vi.fn(), getRecentLearnings: vi.fn() }));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: vi.fn() }));
vi.mock('../learning.js', () => ({ getRecentLearnings: vi.fn(() => []) }));
vi.mock('../suggestion-triage.js', () => ({ createSuggestion: vi.fn(), PRIORITY_WEIGHTS: {} }));
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestions: vi.fn() }));
vi.mock('../executor.js', () => ({ triggerCeceliaRun: vi.fn(), checkCeceliaRunAvailable: vi.fn() }));
vi.mock('../tick-helpers.js', () => ({ routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../routes/shared.js', () => ({ classifyLearningType: vi.fn().mockResolvedValue(null) }));
// T12: mock capture-inbox（ESM export 无法 vi.spyOn，用工厂 mock；等价断言，与 handoff.test.js 手法一致）
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn().mockResolvedValue('atom-1') }));

import router from '../routes/tasks.js';

// 真实 Express handler；数据库和外部副作用在模块边界隔离。

describe('POST /api/brain/learnings-received', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCreateTask.mockReset();
    mockQuery.mockRejectedValue(new Error('未配置的数据库访问'));
    mockCreateTask.mockRejectedValue(new Error('未配置的任务写入'));
  });

  it('issues_found → 创建 fix task', async () => {
    mockCreateTask.mockResolvedValue({ task: { id: 'task-uuid-1' } });
    mockQuery.mockResolvedValue({ rows: [] }); // cecelia_events insert

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({ issues_found: ['CI 失败：版本号未同步'], next_steps_suggested: [], branch_name: 'cp-test', pr_number: 42, task_id: 'source-task' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toEqual({ success: true, tasks_created: 1, learnings_inserted: 0, task_ids: ['task-uuid-1'], learning_ids: [] });
    expect(mockCreateTask).toHaveBeenCalledWith({
      title: 'Fix: CI 失败：版本号未同步',
      description: '来源：LEARNINGS_RECEIVED（分支 cp-test / PR #42）\n\nCI 失败：版本号未同步',
      task_type: 'dev', priority: 'P1', trigger_source: 'learnings_received',
      payload: { branch_name: 'cp-test', pr_number: 42, task_id: 'source-task', source: 'learnings_received' },
    });
  });

  it('next_steps_suggested → 写 learnings 表（成长线）', async () => {
    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-uuid-1' }] : [] }));

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['每次修改版本号后立即检查 package-lock.json 同步'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body).toEqual({ success: true, tasks_created: 0, learnings_inserted: 1, task_ids: [], learning_ids: ['learning-uuid-1'] });
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('空内容时正常返回（无 task、无 learning）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({ issues_found: [], next_steps_suggested: [] });

    expect(response.status).toBe(200);
    expect(response.body.tasks_created).toBe(0);
    expect(response.body.learnings_inserted).toBe(0);
  });

  it('两条内容都有时，各自路由到正确路径', async () => {
    mockCreateTask.mockResolvedValue({ task: { id: 'task-1' } });
    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-1' }] : [] }));

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: ['DoD 格式不合法导致 DevGate 失败'],
        next_steps_suggested: ['写 DoD 时先检查 Test 字段白名单格式'],
      });

    expect(response.status).toBe(200);
    expect(response.body.tasks_created).toBe(1);
    expect(response.body.learnings_inserted).toBe(1);
  });
});

describe('真实 learning 路由的单项故障隔离', () => {
  it('无效条目不建单，首项写入失败仍返回后续任务与学习的真实ID', async () => {
    mockQuery.mockReset().mockImplementation(async sql => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-survivor' }] : [] }));
    mockCreateTask.mockReset().mockRejectedValueOnce(new Error('fixture_write_failed')).mockResolvedValueOnce({ task: { id: 'task-survivor' } });
    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);
    const response = await request(app).post('/api/brain/learnings-received').send({
      issues_found: [null, 1, '', '失败项', '成功项'], next_steps_suggested: ['有效学习'], task_id: 'source-task',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, tasks_created: 1, learnings_inserted: 1, task_ids: ['task-survivor'], learning_ids: ['learning-survivor'] });
    expect(mockCreateTask).toHaveBeenCalledTimes(2);
    expect(mockCreateTask.mock.calls.map(([task]) => task.title)).toEqual(['Fix: 失败项', 'Fix: 成功项']);
  });
});

// ── migration 151: source_branch / source_pr / repo 字段测试 ──────────

describe('learnings-received: migration 151 — 来源追踪字段', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCreateTask.mockReset();
    mockQuery.mockRejectedValue(new Error('未配置的数据库访问'));
    mockCreateTask.mockRejectedValue(new Error('未配置的任务写入'));
  });

  it('INSERT 时应包含 source_branch 字段（来自 branch_name）', async () => {
    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-src-1' }] : [] }));

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['写 migration 前先 fetch main 确认最大号'],
        branch_name: 'cp-03121915-step10-learning-db',
        pr_number: '892',
        repo: 'cecelia',
      });

    // 验证 INSERT 时传入了 source_branch
    const insertCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('source_branch'));
    expect(insertCall).toBeTruthy();
    const params = insertCall[1];
    expect(params[2]).toBe('cp-03121915-step10-learning-db'); // source_branch ($3)
    expect(params[3]).toBe('892');                            // source_pr ($4)
    expect(params[4]).toBe('cecelia');                       // repo ($5)
  });

  it('branch_name 为空时 source_branch 为 null', async () => {
    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-src-2' }] : [] }));

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    await request(app)
      .post('/api/brain/learnings-received')
      .send({ next_steps_suggested: ['测试预防措施'] });

    const insertCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('source_branch'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][2]).toBeNull(); // source_branch null
    expect(insertCall[1][3]).toBeNull(); // source_pr null
  });

  it('repo 字段默认为 cecelia', async () => {
    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'lr-3' }] : [] }));

    const app = express();
    app.use(express.json());

    app.use('/api/brain', router);

    await request(app)
      .post('/api/brain/learnings-received')
      .send({ next_steps_suggested: ['某项预防措施'], branch_name: 'cp-test' });

    // repo 默认值为 'cecelia'（不传 repo 时）
    const insertCall = mockQuery.mock.calls.find(([sql]) => /INSERT INTO learnings/.test(sql));
    expect(insertCall[1][4]).toBe('cecelia');
  });
});

// ── T12: capture_atoms 收件箱补线 ──────────────────────────

describe('learnings-received: T12 — capture_atoms 收件箱补线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCreateTask.mockReset();
    mockQuery.mockRejectedValue(new Error('未配置的数据库访问'));
    mockCreateTask.mockRejectedValue(new Error('未配置的任务写入'));
  });

  it('next_steps_suggested 插入 learnings 成功后应调用 pushCaptureAtom', async () => {
    const { pushCaptureAtom } = await import('../capture-inbox.js');
    const router = (await import('../routes/tasks.js')).default;

    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-capture-1' }] : [] }));

    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['每次改 migration 前先 fetch main 确认最大号'],
        task_id: 'task-uuid-t12',
      });

    expect(response.status).toBe(200);
    expect(response.body.learnings_inserted).toBe(1);
    expect(pushCaptureAtom).toHaveBeenCalledTimes(1);
    const [, fields] = pushCaptureAtom.mock.calls[0];
    expect(fields.targetType).toBe('learning');
    expect(fields.routedToTable).toBe('learnings');
    expect(fields.routedToId).toBe('learning-capture-1');
  });

  it('pushCaptureAtom 抛错时不应影响 learnings-received 的成功响应', async () => {
    const { pushCaptureAtom } = await import('../capture-inbox.js');
    pushCaptureAtom.mockRejectedValueOnce(new Error('capture_atoms insert failed'));
    const router = (await import('../routes/tasks.js')).default;

    mockQuery.mockImplementation(async (sql) => ({ rows: /INSERT INTO learnings/.test(sql) ? [{ id: 'learning-capture-2' }] : [] }));

    const app = express();
    app.use(express.json());
    app.use('/api/brain', router);

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['测试 pushCaptureAtom 失败不阻塞主流程'],
        task_id: 'task-uuid-t12b',
      });

    expect(response.status).toBe(200);
    expect(response.body.learnings_inserted).toBe(1);
  });
});
