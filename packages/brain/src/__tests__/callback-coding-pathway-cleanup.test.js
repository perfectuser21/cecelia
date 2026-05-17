/**
 * Coding Pathway Cleanup 测试
 * 覆盖本次 PR 的三个改动：
 * D1: 断链#3 mode=design 完成 + 无任何 dev 任务 → 创建 cecelia_events 告警
 * D2: 断链#3 mode=design 完成 + 有历史 dev 任务（全部完成）→ 不创建告警
 * D3: 5e 已删除 — dev task 完成不再触发 initiative_plan
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
vi.mock('../review-gate.js', () => ({ processReviewResult: vi.fn(async () => {}) }));
vi.mock('../progress-ledger.js', () => ({ recordProgressStep: vi.fn(async () => {}) }));
vi.mock('../llm-caller.js', () => ({ callLLM: vi.fn(async () => ({})) }));
vi.mock('../working-memory.js', () => ({ getMemory: vi.fn(async () => null), setMemory: vi.fn(async () => {}) }));
vi.mock('../watchdog.js', () => ({ startWatching: vi.fn(), stopWatching: vi.fn(), sampleAll: vi.fn(async () => []) }));
vi.mock('../desire-engine.js', () => ({ processDesires: vi.fn(async () => ({})) }));
vi.mock('../dev-failure-classifier.js', () => ({ classifyDevFailure: vi.fn(async () => ({})) }));
vi.mock('../self-model.js', () => ({ updateSelfModel: vi.fn(async () => {}), getSelfModel: vi.fn(async () => ({})) }));
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));
vi.mock('../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));

import express from 'express';
import request from 'supertest';

// ============================================================
// 断链#3: architecture_design(design) mode 完成回调
// ============================================================

describe('断链#3: architecture_design(design) 完成 → 告警逻辑', () => {
  let app;
  const adTaskId = 'ad-design-task-001';
  const projectId = 'proj-initiative-design-001';
  const goalId = 'goal-design-001';

  function setupAdDesignMock({ activeDevCnt, histDevCnt }) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 task 信息（5c7 断链#3）
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === adTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'architecture_design',
            project_id: projectId,
            goal_id: goalId,
            title: 'M2 Architecture Design',
            payload: { mode: 'design', initiative_id: projectId }
          }]
        });
      }
      // 活跃 dev 任务数（queued/in_progress）
      if (typeof sql === 'string' && sql.includes('task_type') && sql.includes("status IN ('queued', 'in_progress')") && sql.includes("task_type = 'dev'")) {
        return Promise.resolve({ rows: [{ cnt: String(activeDevCnt) }] });
      }
      // 历史 dev 任务数（全部状态）
      if (typeof sql === 'string' && sql.includes("task_type = 'dev'") && !sql.includes('status')) {
        return Promise.resolve({ rows: [{ cnt: String(histDevCnt) }] });
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

  it('D1: architecture_design(design) 完成 + 无任何 dev 任务 → 创建 cecelia_events 告警', async () => {
    setupAdDesignMock({ activeDevCnt: 0, histDevCnt: 0 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: adTaskId, run_id: 'run-ad-1', status: 'AI Done', result: {} });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'cecelia_events',
        trigger_source: 'execution_callback_断链3',
      })
    );
  }, { timeout: 10000 });

  it('D2: architecture_design(design) 完成 + 历史有 dev 任务（全部完成）→ 不创建告警', async () => {
    setupAdDesignMock({ activeDevCnt: 0, histDevCnt: 3 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: adTaskId, run_id: 'run-ad-2', status: 'AI Done', result: {} });

    expect(res.status).toBe(200);
    // cecelia_events 告警不应被创建（所有 dev 任务都已完成，属于正常结束）
    const ceceliaEventsCall = mockCreateTask.mock.calls.find(
      call => call[0]?.task_type === 'cecelia_events' && call[0]?.trigger_source === 'execution_callback_断链3'
    );
    expect(ceceliaEventsCall).toBeUndefined();
  }, { timeout: 10000 });

  it('D3: dev task 完成（在 initiative 内）→ 不创建 initiative_plan（5e 已删除）', async () => {
    const devTaskId = 'dev-in-initiative-001';

    mockPool.query.mockImplementation((sql, params) => {
      // dev task 查询（serial dispatch 5c11）
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === devTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: goalId,
            title: 'Dev Task In Initiative',
            payload: { sequence_order: 1 }
          }]
        });
      }
      // architecture_design 查询 → 非 architecture_design，跳过 5c7
      if (typeof sql === 'string' && sql.includes('architecture_design')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: devTaskId, run_id: 'run-dev-1', status: 'AI Done', result: {} });

    expect(res.status).toBe(200);
    // initiative_plan 不应被创建（5e 已删除）
    const initiativePlanCall = mockCreateTask.mock.calls.find(
      call => call[0]?.task_type === 'initiative_plan' && call[0]?.trigger_source === 'execution_callback'
    );
    expect(initiativePlanCall).toBeUndefined();
  }, { timeout: 10000 });
});
