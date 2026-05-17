/**
 * 断链#4 NEEDS_FIX 轮次上限测试
 *
 * DoD: D1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn(() => mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } });

vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));
vi.mock('../focus.js', () => ({ getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn() }));
vi.mock('../tick.js', () => ({ getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(), executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })), routeTask: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'code_review', 'initiative_verify', 'initiative_plan', 'decomp_review', 'architecture_design'] }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), ACTION_WHITELIST: [] }));
vi.mock('../cortex.js', () => ({ analyzeEvent: vi.fn(async () => ({})), loadReflectionState: vi.fn(async () => {}) }));
vi.mock('../alertness.js', () => ({ getAlertnessLevel: vi.fn(() => ({ level: 1, levelName: 'CALM' })), updateAlertnessFromEvent: vi.fn(async () => {}), setAlertnessOverride: vi.fn(), clearAlertnessOverride: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}), reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}), sendFeishuMessage: vi.fn(async () => {}) }));
vi.mock('../event-bus.js', () => ({ emitEvent: vi.fn(async () => {}), emit: vi.fn(async () => {}), onEvent: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), ensureEventsTable: vi.fn(async () => {}), queryEvents: vi.fn(async () => []), getEventCounts: vi.fn(async () => ({})) }));
vi.mock('../auto-learning.js', () => ({ triggerLearningCapture: vi.fn(async () => {}), processExecutionAutoLearning: vi.fn(async () => null) }));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn(async () => {}) }));
vi.mock('../proactive-mouth.js', () => ({ notifyTaskCompletion: vi.fn(async () => {}) }));
vi.mock('../review-gate.js', () => ({ processReviewResult: vi.fn(async () => {}) }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({})) }));
vi.mock('../working-memory.js', () => ({ getMemory: vi.fn(async () => null), setMemory: vi.fn(async () => {}) }));
vi.mock('../watchdog.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn(), sampleAll: vi.fn(async () => []) }));
vi.mock('../desire-engine.js', () => ({ processDesires: vi.fn(async () => ({})) }));
vi.mock('../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn(async () => ({})) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn(async () => {}), getSelfModel: vi.fn(async () => ({})) }));
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));

import express from 'express';
import request from 'supertest';

describe('断链#4: NEEDS_FIX 轮次上限', () => {
  let app;
  const taskId = 'cr-task-fix-rounds';
  const projectId = 'proj-fix-rounds-001';
  const goalId = 'goal-fix-rounds-001';

  function setupCodeReviewMock({ existingFixCount = 0 } = {}) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 code_review task 信息
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'code_review',
            project_id: projectId,
            goal_id: goalId,
            title: 'Initiative code review',
            payload: { scope: 'initiative', initiative_id: projectId }
          }]
        });
      }
      // COUNT 已有 fix tasks（模拟历史轮次）
      if (typeof sql === 'string' && sql.includes("COUNT(*)") && sql.includes("fix_type") && sql.includes("code_review_issues")) {
        return Promise.resolve({ rows: [{ cnt: existingFixCount }] });
      }
      // 检查当前活跃修复 task
      if (typeof sql === 'string' && sql.includes("LIKE '[修复]%'")) {
        return Promise.resolve({ rows: [] });
      }
      // INSERT INTO cecelia_events
      if (typeof sql === 'string' && sql.includes('INSERT INTO cecelia_events')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockResolvedValue({ rows: [] });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes.js?v=' + Date.now());
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('D1a: NEEDS_FIX 第 1 轮（existingFix=0）→ 创建修复 dev task', async () => {
    setupCodeReviewMock({ existingFixCount: 0 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-1a', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        payload: expect.objectContaining({ fix_type: 'code_review_issues', revision_round: 1 })
      })
    );
    // 不应触发 P0 告警
    const alertCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_max_fixes_exceeded'
    );
    expect(alertCall).toBeUndefined();
  }, 10000);

  it('D1b: NEEDS_FIX 第 2 轮（existingFix=1）→ 创建修复 dev task（revision_round=2）', async () => {
    setupCodeReviewMock({ existingFixCount: 1 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-1b', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        payload: expect.objectContaining({ fix_type: 'code_review_issues', revision_round: 2 })
      })
    );
  }, 10000);

  it('D1c: NEEDS_FIX 第 4 轮（existingFix=3，超上限）→ 写 cecelia_events，不创建 dev task', async () => {
    setupCodeReviewMock({ existingFixCount: 3 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-1c', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    // 不应创建新 dev task
    const devCall = mockCreateTask.mock.calls.find(c => c[0]?.task_type === 'dev');
    expect(devCall).toBeUndefined();
    // 应触发 P0 告警
    const alertCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_max_fixes_exceeded'
    );
    expect(alertCall).toBeDefined();
    const payload = JSON.parse(alertCall[1][2]);
    expect(payload.project_id).toBe(projectId);
    expect(payload.fix_round).toBe(3);
  }, 10000);
});
