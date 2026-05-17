/**
 * Dev Task 串行调度测试
 * 断链#5c11: dev task 完成（有 sequence_order）→ 解锁并注入 prev_task_result 到下一个串行 task
 *
 * DoD: D1-D4
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

// === 断链#5c11 测试：dev task 串行调度 ===

beforeAll(() => {
  vi.resetModules();
});

describe('断链#5c11: dev task 串行调度', () => {
  let app;
  const taskId = 'dev-task-seq1';
  const projectId = 'proj-serial-001';
  const goalId = 'goal-serial-001';
  const nextTaskId = 'dev-task-seq2';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes.js?v=' + Date.now());
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('D1: 串行 dev task（seq=1）完成 → 找到 blocked 下一个 task（seq=2）→ UPDATE status=queued', async () => {
    mockPool.query.mockImplementation((sql, params) => {
      // 5c11: 查询当前 task（sequence_order=1）
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: goalId,
            title: 'Dev Task 1',
            payload: { sequence_order: 1 }
          }]
        });
      }
      // 5c11: 查询下一个 blocked task（seq=2）
      if (typeof sql === 'string' && sql.includes("payload->>'sequence_order'") && sql.includes('blocked')) {
        return Promise.resolve({
          rows: [{ id: nextTaskId, title: 'Dev Task 2', payload: { sequence_order: 2, depends_on_prev: 'true' } }]
        });
      }
      // UPDATE tasks（解锁）
      if (typeof sql === 'string' && sql.includes('UPDATE tasks') && sql.includes("status = 'queued'")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: taskId,
        run_id: 'run-1',
        status: 'AI Done',
        result: { summary: 'Feature X implemented', pr_url: 'https://github.com/org/repo/pull/100' },
        pr_url: 'https://github.com/org/repo/pull/100'
      });

    expect(res.status).toBe(200);

    // 验证 UPDATE tasks SET status = 'queued' 被调用
    const updateCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes("status = 'queued'") && c[1]?.[1] === nextTaskId
    );
    expect(updateCall).toBeDefined();
  }, 10000);

  it('D2: 解锁后的 task payload 包含 prev_task_result（含 summary/pr_url/task_id）', async () => {
    const prUrl = 'https://github.com/org/repo/pull/101';
    const resultSummary = 'Auth module completed';

    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: goalId,
            title: 'Dev Task 1',
            payload: { sequence_order: 1 }
          }]
        });
      }
      if (typeof sql === 'string' && sql.includes("payload->>'sequence_order'") && sql.includes('blocked')) {
        return Promise.resolve({
          rows: [{ id: nextTaskId, title: 'Dev Task 2', payload: { sequence_order: 2, depends_on_prev: 'true', existing_field: 'kept' } }]
        });
      }
      if (typeof sql === 'string' && sql.includes('UPDATE tasks') && sql.includes("status = 'queued'")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: taskId,
        run_id: 'run-2',
        status: 'AI Done',
        result: { summary: resultSummary },
        pr_url: prUrl
      });

    expect(res.status).toBe(200);

    // 找 UPDATE 调用，验证注入的 payload 含 prev_task_result
    const updateCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes("status = 'queued'") && c[1]?.[1] === nextTaskId
    );
    expect(updateCall).toBeDefined();

    const injectedPayload = JSON.parse(updateCall[1][0]);
    expect(injectedPayload.prev_task_result).toBeDefined();
    expect(injectedPayload.prev_task_result.task_id).toBe(taskId);
    expect(injectedPayload.prev_task_result.summary).toBe(resultSummary);
    expect(injectedPayload.prev_task_result.pr_url).toBe(prUrl);
    expect(injectedPayload.prev_task_result.sequence_order).toBe(1);
    // 原有字段保留
    expect(injectedPayload.existing_field).toBe('kept');
  }, 10000);

  it('D3: 最后一个串行 task（seq=2，无 N+1）→ 不触发 UPDATE，断链#5 正常继续', async () => {
    const lastTaskId = 'dev-task-seq2-last';

    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === lastTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: goalId,
            title: 'Dev Task 2 (last)',
            payload: { sequence_order: 2 }
          }]
        });
      }
      // 下一个 blocked task 查询返回空（没有 seq=3）
      if (typeof sql === 'string' && sql.includes("payload->>'sequence_order'") && sql.includes('blocked')) {
        return Promise.resolve({ rows: [] });
      }
      // 断链#5: 检查同 project 所有 dev 是否完成
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('project_id') && sql.includes("status != 'completed'")) {
        return Promise.resolve({ rows: [] }); // 全完成
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: lastTaskId,
        run_id: 'run-3',
        status: 'AI Done',
        result: { summary: 'Last task done' }
      });

    expect(res.status).toBe(200);

    // 不应该有 UPDATE tasks SET status = 'queued'（串行解锁用）
    const serialUpdateCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE tasks') && c[0].includes("status = 'queued'") && c[1]?.[1] === lastTaskId
    );
    expect(serialUpdateCall).toBeUndefined();
  }, 10000);

  it('D4: 独立 task（sequence_order=null）→ 跳过串行逻辑，断链#5 正常运行', async () => {
    const independentTaskId = 'dev-task-independent';

    mockPool.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === independentTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: goalId,
            title: 'Independent Dev Task',
            payload: {} // 无 sequence_order
          }]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: independentTaskId,
        run_id: 'run-4',
        status: 'AI Done',
        result: { summary: 'Independent task done' }
      });

    expect(res.status).toBe(200);

    // 不应有针对串行 blocked 下一任务的查询
    const serialNextQuery = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes("payload->>'sequence_order'") && c[0].includes('blocked')
    );
    expect(serialNextQuery).toBeUndefined();
  }, 10000);
});
