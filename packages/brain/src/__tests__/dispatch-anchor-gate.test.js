/**
 * S2 锚点闸——手动派发旁路封堵（MJ5 刀2 验火产物）
 *
 * 背景：checkAnchor 原本只站在 tick dispatcher（dispatcher.js 3c''），
 * POST /tasks/:id/dispatch 与 POST /dispatch-now 两个手动派发端点完全绕过锚点闸。
 * 铁律：闸必须站住所有必经之路（PRD 2026-07-17-mj5 §四）。
 *
 * 断言：无锚新任务走手动派发 → 422 missing_anchor，不点火、不改状态。
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
vi.mock('fs', () => ({ readFileSync: vi.fn(() => ''), readdirSync: vi.fn(() => []) }));
// T12: mock capture-inbox（ESM export 无法 vi.spyOn，用工厂 mock；等价断言，与 handoff.test.js 手法一致）
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn().mockResolvedValue('atom-1') }));


// 本测试需要控制 executor（learnings 前奏未 mock）
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
}));

import { triggerCeceliaRun, checkCeceliaRunAvailable } from '../executor.js';

function freshTask(extra = {}) {
  return {
    id: 't-anchor-1',
    task_type: 'dev',
    status: 'queued',
    created_at: new Date().toISOString(), // 存量豁免 cutoff 之后
    payload: {},
    ...extra,
  };
}

async function makeTasksApp() {
  const router = (await import('../routes/tasks.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

describe('POST /tasks/:id/dispatch — S2 锚点闸站岗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无锚新任务 → 422 missing_anchor，不点火不改状态', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [freshTask()] }); // SELECT task
    const app = await makeTasksApp();
    const res = await request(app).post('/api/brain/tasks/t-anchor-1/dispatch');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('missing_anchor');
    expect(triggerCeceliaRun).not.toHaveBeenCalled();
    const updateCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes("'in_progress'"));
    expect(updateCall).toBeUndefined();
  });

  it('带锚任务 → 照常点火', async () => {
    const anchored = freshTask({
      payload: { anchor: { journey_id: 'j1', gp_id: 'g1', step_id: 's1' } },
    });
    mockQuery.mockResolvedValue({ rows: [anchored] });
    checkCeceliaRunAvailable.mockResolvedValue({ available: true });
    triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'r1' });
    const app = await makeTasksApp();
    const res = await request(app).post('/api/brain/tasks/t-anchor-1/dispatch');
    expect([200, 202]).toContain(res.status);
    expect(triggerCeceliaRun).toHaveBeenCalled();
  });

  it('豁免 task_type（如 ci_patrol）无锚 → 照常点火', async () => {
    const exempt = freshTask({ task_type: 'ci_patrol' });
    mockQuery.mockResolvedValue({ rows: [exempt] });
    checkCeceliaRunAvailable.mockResolvedValue({ available: true });
    triggerCeceliaRun.mockResolvedValue({ success: true, runId: 'r2' });
    const app = await makeTasksApp();
    const res = await request(app).post('/api/brain/tasks/t-anchor-1/dispatch');
    expect([200, 202]).toContain(res.status);
    expect(triggerCeceliaRun).toHaveBeenCalled();
  });
});
