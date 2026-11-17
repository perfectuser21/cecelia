/** 审查回执保留原结果与终态，daily、Review及Initiative问题不再衍生开发单。 */

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

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-fix-task-id' } });
vi.mock('../actions.js', () => ({
  createTask: mockCreateTask,
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
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
  getInternalTaskHandler: vi.fn(() => null), identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'code_review', 'initiative_verify', 'initiative_plan', 'decomp_review', 'architecture_design'] }));
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

vi.mock('../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));

import express from 'express';
import request from 'supertest';

describe('审查问题不再自动开发', () => {
  let app;
  const taskId = 'daily-cr-001';
  const repoPath = '/Users/administrator/perfect21/cecelia';

  // existingDailyFix=true 时模拟「已有未完成 daily 修复 task」
  function setupDailyMock({ existingDailyFix = false, taskType = 'code_review', scope = 'daily' } = {}) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 code_review task 信息（daily scope，无 project_id / goal_id）
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: taskType,
            project_id: scope === 'initiative' ? 'project-1' : null,
            goal_id: null,
            title: '[code-review] cecelia 2026-06-20',
            payload: { scope, repo_path: repoPath, since_hours: 24 },
          }],
        });
      }
      // 幂等检查：是否已有未完成 daily 修复 task
      if (typeof sql === 'string' && sql.includes("fix_type' = 'daily_review_issues'")) {
        return Promise.resolve({ rows: existingDailyFix ? [{ id: 'existing-fix' }] : [] });
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

  it.each([
    ['NEEDS_FIX', 0, 3], ['CRITICAL_BLOCK', 2, 1], ['PASS', 0, 0], ['PASS', 1, 0],
  ])('daily %s L1=%i L2=%i 只保存回执，不衍生开发任务', async (decision, l1_count, l2_count) => {
    setupDailyMock();
    const result = { decision, l1_count, l2_count };
    const res = await request(app).post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-daily', status: 'AI Done', result });
    expect(res.status).toBe(200);
    expect(mockCreateTask.mock.calls.filter(([task]) => ['dev', 'coding_workflow'].includes(task.task_type))).toEqual([]);
    expect(mockClient.query.mock.calls.some(([sql, params]) => sql.includes('UPDATE tasks') && JSON.stringify(params).includes('completed'))).toBe(true);
    const persisted = mockClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE tasks') && sql.includes('last_run_result'));
    expect(typeof result === 'string' ? persisted[1][6] : JSON.parse(persisted[1][6])).toEqual(result);
  }, 10000);
  it.each([
    ['review', 'daily', 'L1: 必修问题'],
    ['code_review', 'initiative', { decision: 'NEEDS_FIX' }],
    ['code_review', 'initiative', 'TEST_BLOCK: 集成测试失败'],
    ['initiative_verify', 'initiative', { verdict: 'NEEDS_REVISION' }],
  ])('%s %s 问题回执只留原结果，不新建编码单', async (taskType, scope, result) => {
    setupDailyMock({ taskType, scope });
    const res = await request(app).post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'review-original', status: 'AI Done', result });
    expect(res.status).toBe(200);
    expect(mockCreateTask.mock.calls.filter(([task]) => ['dev', 'coding_workflow'].includes(task.task_type))).toEqual([]);
    expect(mockClient.query.mock.calls.some(([sql, params]) => sql.includes('UPDATE tasks') && JSON.stringify(params).includes('completed'))).toBe(true);
    const persisted = mockClient.query.mock.calls.find(([sql]) => sql.includes('UPDATE tasks') && sql.includes('last_run_result'));
    expect(typeof result === 'string' ? persisted[1][6] : JSON.parse(persisted[1][6])).toEqual(result);
  }, 10000);

});
