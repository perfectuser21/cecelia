/**
 * callback-arch-design-unblock.test.js
 *
 * 测试 execution-callback 中 architecture_design(mode='design') 完成后：
 *   - 有 blocked dev task → 自动 unblock 第一个
 *   - 无 blocked dev task → 不报错，正常跳过
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUnblockTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'blocked-dev-id', title: 'blocked dev task' } });

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  release: vi.fn(),
};

const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  connect: vi.fn(() => mockClient),
};
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
  unblockTask: mockUnblockTask,
}));

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
vi.mock('../task-router.js', () => ({ identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(), isValidTaskType: vi.fn(() => true), getDomainSkillOverride: vi.fn(() => null), VALID_TASK_TYPES: ['dev', 'code_review', 'initiative_verify', 'initiative_plan', 'decomp_review', 'architecture_design', 'cecelia_events'] }));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(async () => ({})), ACTION_WHITELIST: [] }));
vi.mock('../cortex.js', () => ({ analyzeEvent: vi.fn(async () => ({})), loadReflectionState: vi.fn(async () => {}) }));
vi.mock('../alertness.js', () => ({ getAlertnessLevel: vi.fn(() => ({ level: 1, levelName: 'CALM' })), updateAlertnessFromEvent: vi.fn(async () => {}), setAlertnessOverride: vi.fn(), clearAlertnessOverride: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({ getState: vi.fn(() => ({})), isAllowed: vi.fn(() => true), recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}), reset: vi.fn(async () => {}), getAllStates: vi.fn(() => ({})), FAILURE_THRESHOLD: 3, OPEN_DURATION_MS: 60000 }));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn(async () => {}), notifyTaskFailed: vi.fn(async () => {}), sendFeishuMessage: vi.fn(async () => {}) }));
vi.mock('../event-bus.js', () => ({ emitEvent: vi.fn(async () => {}), emit: vi.fn(async () => {}), onEvent: vi.fn(), publishTaskCompleted: vi.fn(), publishTaskFailed: vi.fn(), ensureEventsTable: vi.fn(async () => {}), queryEvents: vi.fn(async () => []), getEventCounts: vi.fn(async () => ({})) }));
vi.mock('../auto-learning.js', () => ({ triggerLearningCapture: vi.fn(async () => {}), processExecutionAutoLearning: vi.fn(async () => null) }));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn(async () => {}) }));
vi.mock('../proactive-mouth.js', () => ({ notifyTaskCompletion: vi.fn(async () => {}) }));
vi.mock('../review-gate.js', () => ({ processReviewResult: vi.fn(async () => {}), shouldTriggerReview: vi.fn(async () => false), createReviewTask: vi.fn(async () => {}) }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({})) }));
vi.mock('../working-memory.js', () => ({ getMemory: vi.fn(async () => null), setMemory: vi.fn(async () => {}) }));
vi.mock('../watchdog.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn(), sampleAll: vi.fn(async () => []) }));
vi.mock('../desire-engine.js', () => ({ processDesires: vi.fn(async () => ({})) }));
vi.mock('../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn(async () => ({})) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn(async () => {}), getSelfModel: vi.fn(async () => ({})) }));
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));
vi.mock('../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));
vi.mock('../progress-reviewer.js', () => ({ executePlanAdjustment: vi.fn(async () => {}) }));

import express from 'express';
import request from 'supertest';

// ============================================================
// AC-3: architecture_design(mode=design) 完成 → unblock 第一个 blocked dev task
// ============================================================

describe('断链#3: architecture_design(design) 完成后 unblock blocked dev task', () => {
  const archTaskId = 'arch-task-001';
  const projectId = 'initiative-proj-001';
  const goalId = 'goal-001';
  const blockedDevTaskId = 'blocked-dev-task-001';

  function setupMock({ hasBlockedDevTask }) {
    mockUnblockTask.mockReset();
    mockUnblockTask.mockResolvedValue({ success: true, task: { id: blockedDevTaskId, title: 'blocked dev task' } });

    mockPool.query.mockImplementation((sql, params) => {
      const q = typeof sql === 'string' ? sql.trim() : '';

      // 1. 查询任务基本信息
      if (q.includes('SELECT') && q.includes('task_type') && q.includes('payload') && params?.[0] === archTaskId && !q.includes('task_run_metrics')) {
        return Promise.resolve({
          rows: [{
            task_type: 'architecture_design',
            project_id: projectId,
            goal_id: goalId,
            title: 'arch design task',
            payload: { mode: 'design', initiative_id: projectId, kr_id: goalId }
          }]
        });
      }

      // 2. 查询 blocked dev task
      if (q.includes("status = 'blocked'") && q.includes("task_type = 'dev'")) {
        if (hasBlockedDevTask) {
          return Promise.resolve({
            rows: [{ id: blockedDevTaskId, title: 'blocked dev task' }]
          });
        }
        return Promise.resolve({ rows: [] });
      }

      // 3. 查询 queued/in_progress dev tasks（告警检查）
      if (q.includes("status IN ('queued', 'in_progress')") && q.includes("task_type = 'dev'")) {
        return Promise.resolve({ rows: [{ cnt: '1' }] });
      }

      // 4. 更新任务状态
      if (q.includes('UPDATE tasks') && q.includes('status')) {
        return Promise.resolve({ rows: [{ id: archTaskId, status: 'completed' }] });
      }

      // 5. pending_actions 检查（decomp review 等）
      if (q.includes('pending_actions')) {
        return Promise.resolve({ rows: [] });
      }

      // 6. task_run_metrics
      if (q.includes('task_run_metrics')) {
        return Promise.resolve({ rows: [] });
      }

      // 默认返回空
      return Promise.resolve({ rows: [] });
    });
  }

  let app;
  beforeEach(async () => {
    vi.resetModules();
    const routesModule = await import('../routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', routesModule.default);
  });

  it('有 blocked dev task 时应调用 unblockTask', async () => {
    setupMock({ hasBlockedDevTask: true });

    const response = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: archTaskId,
        status: 'AI Done',
        result: { success: true }
      });

    expect(response.status).toBe(200);
    expect(mockUnblockTask).toHaveBeenCalledWith(blockedDevTaskId);
  });

  it('无 blocked dev task 时不调用 unblockTask，不报错', async () => {
    setupMock({ hasBlockedDevTask: false });

    const response = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: archTaskId,
        status: 'AI Done',
        result: { success: true }
      });

    expect(response.status).toBe(200);
    expect(mockUnblockTask).not.toHaveBeenCalled();
  });
});
