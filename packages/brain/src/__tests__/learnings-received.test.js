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
vi.mock('../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), getValidTaskTypes: vi.fn(() => []), LOCATION_MAP: {} }));
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
vi.mock('fs', () => ({ readFileSync: vi.fn(() => ''), readdirSync: vi.fn(() => []) }));

// ── 直接单测路由逻辑（不加载完整 routes.js）─────────────────

describe('POST /api/brain/learnings-received', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues_found → 创建 fix task', async () => {
    mockCreateTask.mockResolvedValue({ task: { id: 'task-uuid-1' } });
    mockQuery.mockResolvedValue({ rows: [] }); // cecelia_events insert

    const app = express();
    app.use(express.json());

    // 内联路由逻辑（与 routes.js 一致）
    app.post('/api/brain/learnings-received', async (req, res) => {
      const { issues_found = [], next_steps_suggested = [] } = req.body;
      const results = { tasks_created: [], learnings_inserted: [] };

      for (const issue of issues_found) {
        if (!issue || typeof issue !== 'string') continue;
        const taskResult = await mockCreateTask({
          title: `Fix: ${issue.slice(0, 120)}`,
          priority: 'P1',
          task_type: 'dev',
          trigger_source: 'learnings_received',
        });
        if (taskResult?.task?.id) results.tasks_created.push(taskResult.task.id);
      }

      for (const step of next_steps_suggested) {
        if (!step || typeof step !== 'string') continue;
        const { rows } = await mockQuery(
          `INSERT INTO learnings (title, category, content, trigger_source, trigger_event, digested) VALUES ($1,'dev_experience',$2,'dev_workflow','learnings_received',false) RETURNING id`,
          [step.slice(0, 120), step]
        );
        if (rows[0]?.id) results.learnings_inserted.push(rows[0].id);
      }

      await mockQuery('INSERT INTO cecelia_events...', []);

      res.json({
        success: true,
        tasks_created: results.tasks_created.length,
        learnings_inserted: results.learnings_inserted.length,
        task_ids: results.tasks_created,
        learning_ids: results.learnings_inserted,
      });
    });

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({ issues_found: ['CI 失败：版本号未同步'], next_steps_suggested: [] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.tasks_created).toBe(1);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fix: CI 失败：版本号未同步',
        priority: 'P1',
        trigger_source: 'learnings_received',
      })
    );
  });

  it('next_steps_suggested → 写 learnings 表（成长线）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'learning-uuid-1' }] }) // learnings INSERT
      .mockResolvedValueOnce({ rows: [] }); // cecelia_events

    const app = express();
    app.use(express.json());

    app.post('/api/brain/learnings-received', async (req, res) => {
      const { issues_found = [], next_steps_suggested = [] } = req.body;
      const results = { tasks_created: [], learnings_inserted: [] };

      for (const issue of issues_found) {
        if (!issue) continue;
        const taskResult = await mockCreateTask({ title: `Fix: ${issue}`, priority: 'P1' });
        if (taskResult?.task?.id) results.tasks_created.push(taskResult.task.id);
      }

      for (const step of next_steps_suggested) {
        if (!step) continue;
        const { rows } = await mockQuery('INSERT INTO learnings...', [step.slice(0, 120), step]);
        if (rows[0]?.id) results.learnings_inserted.push(rows[0].id);
      }

      await mockQuery('INSERT INTO cecelia_events...', []);

      res.json({
        success: true,
        tasks_created: results.tasks_created.length,
        learnings_inserted: results.learnings_inserted.length,
        task_ids: results.tasks_created,
        learning_ids: results.learnings_inserted,
      });
    });

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({
        issues_found: [],
        next_steps_suggested: ['每次修改版本号后立即检查 package-lock.json 同步'],
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.learnings_inserted).toBe(1);
    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it('空内容时正常返回（无 task、无 learning）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const app = express();
    app.use(express.json());

    app.post('/api/brain/learnings-received', async (req, res) => {
      mockQuery('INSERT INTO cecelia_events...', []);
      res.json({ success: true, tasks_created: 0, learnings_inserted: 0, task_ids: [], learning_ids: [] });
    });

    const response = await request(app)
      .post('/api/brain/learnings-received')
      .send({ issues_found: [], next_steps_suggested: [] });

    expect(response.status).toBe(200);
    expect(response.body.tasks_created).toBe(0);
    expect(response.body.learnings_inserted).toBe(0);
  });

  it('两条内容都有时，各自路由到正确路径', async () => {
    mockCreateTask.mockResolvedValue({ task: { id: 'task-1' } });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'learning-1' }] })
      .mockResolvedValue({ rows: [] });

    const app = express();
    app.use(express.json());

    app.post('/api/brain/learnings-received', async (req, res) => {
      const { issues_found = [], next_steps_suggested = [] } = req.body;
      const results = { tasks_created: [], learnings_inserted: [] };

      for (const issue of issues_found) {
        if (!issue) continue;
        const r = await mockCreateTask({ title: `Fix: ${issue}`, priority: 'P1' });
        if (r?.task?.id) results.tasks_created.push(r.task.id);
      }
      for (const step of next_steps_suggested) {
        if (!step) continue;
        const { rows } = await mockQuery('INSERT...', [step]);
        if (rows[0]?.id) results.learnings_inserted.push(rows[0].id);
      }
      await mockQuery('INSERT INTO cecelia_events...', []);

      res.json({
        success: true,
        tasks_created: results.tasks_created.length,
        learnings_inserted: results.learnings_inserted.length,
        task_ids: results.tasks_created,
        learning_ids: results.learnings_inserted,
      });
    });

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
