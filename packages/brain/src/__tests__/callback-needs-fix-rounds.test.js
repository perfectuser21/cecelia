/**
 * 审查问题回执不衍生新开发单
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
// 业务回归隔离冷却时钟；固定5秒与释放/派发顺序由独立合同覆盖。
vi.mock('../lib/callback-cooldown.js', async original => ({
  ...await original(), waitForCallbackCooldown: vi.fn(async () => {}),
}));

vi.mock('../db.js', () => ({ default: mockPool }));

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-task-id' } });

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

import express from 'express';
import request from 'supertest';

describe('NEEDS_FIX 原问题留账', () => {
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

  it.each([0, 1, 3])('已有%i轮历史修复时仍只记录原审查问题，不新建开发单', async existingFixCount => {
    setupCodeReviewMock({ existingFixCount });
    const res = await request(app).post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'historical-review', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });
    expect(res.status).toBe(200);
    expect(mockCreateTask.mock.calls.filter(([task]) => ['dev', 'coding_workflow'].includes(task.task_type))).toEqual([]);
    const event = mockPool.query.mock.calls.find(([sql, params]) => sql.includes('INSERT INTO cecelia_events') && params[0] === 'initiative_pipeline_blocked');
    expect(JSON.parse(event[1][2])).toMatchObject({ project_id: projectId, alert_type: 'needs_fix', code_review_task_id: taskId });
  }, 10000);
});
