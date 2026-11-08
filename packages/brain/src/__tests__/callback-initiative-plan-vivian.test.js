/**
 * 历史 initiative_plan 完成回执的兼容与旧拆解退役回归
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
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'initiative_plan', 'decomp_review', 'architecture_design'] }));
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
const mockRetiredReviewTrigger = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../decomposition-review-trigger.js', () => ({ triggerCompletedDecompositionReview: mockRetiredReviewTrigger }));
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

describe('execution-callback: 旧拆解退役后仍接收完成回执', () => {
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

  it('历史 initiative_plan 完成回执正常响应且不再自动创建旧审核', async () => {
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

    expect(mockCreateTask.mock.calls.filter(([task]) => task?.task_type === 'decomp_review')).toHaveLength(0);
    expect(mockRetiredReviewTrigger).not.toHaveBeenCalled();
  });

  it.each([
    ['initiative_plan', {}, 'https://github.com/example/repo/pull/1'],
    ['dev', { decomposition: 'true' }, null],
    ['dev', {}, 'https://github.com/example/repo/pull/1'],
  ])('%s 完成回执落终态且不自动创建旧拆解审核', async (taskType, payload, prUrl) => {
    const taskId = 'old-decomposition-finished';
    const state = {
      task: { status: 'in_progress', task_type: taskType, project_id: 'proj-x', goal_id: 'goal-x', title: '任务', payload },
      projectStatus: 'active', krStatus: 'decomposing', krProgress: 0, reviews: [], pendingActions: [],
    };
    mockClient.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('UPDATE tasks')) {
        expect(params[0]).toBe(taskId);
        expect(state.task.status).toBe('in_progress');
        state.task.status = params[1];
        return { rows: [{ task_type: state.task.task_type, payload: state.task.payload }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockPool.query.mockImplementation(async (sql, params) => {
      const query = String(sql);
      if (query.includes('SELECT COUNT(*) as total')) return { rows: [{ total: '4', done: '1' }] };
      if (query.includes('SELECT target_value FROM key_results')) return { rows: [{ target_value: 100 }] };
      if (query.includes('UPDATE key_results SET current_value')) { state.krProgress = params[0]; return { rows: [], rowCount: 1 }; }
      if (query.includes('SELECT') && params?.[0] === taskId) return { rows: [state.task] };
      return { rows: [] };
    });
    const res = await request(app).post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'old-run', status: 'AI Done', pr_url: prUrl, result: { result: '完成' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(res.body.duplicate).not.toBe(true);
    expect(state.task.status).toBe('completed');
    expect(mockClient.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(mockCreateTask.mock.calls.filter(([task]) => task?.task_type === 'decomp_review')).toHaveLength(0);
    expect(mockRetiredReviewTrigger).not.toHaveBeenCalled();
    const writes = [...mockClient.query.mock.calls, ...mockPool.query.mock.calls].map(([sql]) => String(sql));
    expect(writes.some(sql => /(?:INSERT INTO|UPDATE)\s+(?:decomp_reviews|pending_actions)/i.test(sql))).toBe(false);
    expect(writes.some(sql => /UPDATE\s+(?:projects|key_results)\s+SET\s+status/i.test(sql))).toBe(false);
    expect(state).toMatchObject({ projectStatus: 'active', krStatus: 'decomposing', krProgress: 25, reviews: [], pendingActions: [] });
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
