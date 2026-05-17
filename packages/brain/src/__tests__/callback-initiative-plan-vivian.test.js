/**
 * initiative_plan 完成自动触发 Vivian 质检测试
 * DoD-1, DoD-2, DoD-3
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

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-decomp-id' } });

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
vi.mock('../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'initiative_plan', 'decomp_review', 'architecture_design'] }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), ACTION_WHITELIST: [] }));
vi.mock('../cortex.js', () => ({ analyzeEvent: vi.fn(async () => ({})), loadReflectionState: vi.fn(async () => {}) }));
vi.mock('../alertness.js', () => ({ getAlertnessLevel: vi.fn(() => ({ level: 1, levelName: 'CALM' })), updateAlertnessFromEvent: vi.fn(async () => {}), setAlertnessOverride: vi.fn(), clearAlertnessOverride: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}), reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}), sendFeishuMessage: vi.fn(async () => {}) }));
vi.mock('../event-bus.js', () => ({ emitEvent: vi.fn(async () => {}), emit: vi.fn(async () => {}), onEvent: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), ensureEventsTable: vi.fn(async () => {}), queryEvents: vi.fn(async () => []), getEventCounts: vi.fn(async () => ({})) }));
vi.mock('../auto-learning.js', () => ({ triggerLearningCapture: vi.fn(async () => {}) }));
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

describe('execution-callback: initiative_plan → auto decomp_review', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认 pool.query 返回空行
    mockPool.query.mockResolvedValue({ rows: [] });
    // 默认 client.query（事务）返回空行
    mockClient.query.mockResolvedValue({ rows: [] });

    const { default: router } = await import('../routes.js?v=' + Date.now());
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('DoD-1+2: initiative_plan 完成时自动创建 decomp_review task', async () => {
    const taskId = 'test-initiative-plan-id';
    const projectId = 'proj-123';
    const goalId = 'goal-456';

    // 让 pool.query 在查到 task_id 时返回 initiative_plan 数据
    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && params?.[0] === taskId) {
        return Promise.resolve({ rows: [{ task_type: 'initiative_plan', project_id: projectId, goal_id: goalId, title: '拆解用户增长 Initiative', payload: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: taskId,
        run_id: 'run-001',
        status: 'AI Done',
        pr_url: 'https://github.com/test/pr/1',
        result: { findings: '拆解完成' }
      });

    expect(res.status).toBe(200);

    // DoD-1: decomp_review task 被创建
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'decomp_review',
        priority: 'P0',
        project_id: projectId,
        goal_id: goalId,
      })
    );

    // DoD-2: parent_task_id 正确
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          parent_task_id: taskId,
          review_scope: 'initiative_plan'
        })
      })
    );
  });

  it('DoD-3: dev task 完成不触发 decomp_review', async () => {
    const taskId = 'test-dev-task-id';

    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && params?.[0] === taskId) {
        return Promise.resolve({ rows: [{ task_type: 'dev', project_id: 'proj-x', goal_id: 'goal-x', title: '写代码', payload: null }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-002', status: 'AI Done', pr_url: 'https://github.com/test/pr/2' });

    const decompReviewCalls = mockCreateTask.mock.calls.filter(
      call => call[0]?.task_type === 'decomp_review'
    );
    expect(decompReviewCalls).toHaveLength(0);
  });
});
