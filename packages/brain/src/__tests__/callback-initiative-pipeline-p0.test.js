/**
 * Initiative Pipeline P0 修复测试
 * 断链#4: code_review decision 路由（PASS/NEEDS_FIX/CRITICAL_BLOCK/TEST_BLOCK）
 * 断链#6: initiative_verify verdict 处理（APPROVED/NEEDS_REVISION/REJECTED）
 *
 * DoD: D1-D8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// === 断链#4 测试：code_review decision 路由 ===

describe('断链#4: code_review decision 路由（initiative scope）', () => {
  let app;
  const taskId = 'cr-task-001';
  const projectId = 'proj-initiative-001';
  const goalId = 'goal-001';

  // mockPool.query 通用 setup：code_review task
  function setupCodeReviewMock(_decision) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 task 信息（断链#4）
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
      // 检查是否已有 initiative_verify（返回空 = 没有）
      if (typeof sql === 'string' && sql.includes('initiative_verify')) {
        return Promise.resolve({ rows: [] });
      }
      // 检查是否已有修复 dev task
      if (typeof sql === 'string' && sql.includes("LIKE '[修复]%'")) {
        return Promise.resolve({ rows: [] });
      }
      // INSERT INTO cecelia_events
      if (typeof sql === 'string' && sql.includes('INSERT INTO cecelia_events')) {
        return Promise.resolve({ rows: [] });
      }
      // 其余查询（事务、dev task 查询等）
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

  it('D1: code_review PASS → 创建 initiative_verify', async () => {
    setupCodeReviewMock('PASS');

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-1', status: 'AI Done', result: { decision: 'PASS' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'initiative_verify',
        project_id: projectId,
        goal_id: goalId,
      })
    );
    const devCall = mockCreateTask.mock.calls.find(c => c[0]?.task_type === 'dev');
    expect(devCall).toBeUndefined();
  }, 10000);

  it('D2: code_review NEEDS_FIX → 创建修复 dev task（不进 initiative_verify）', async () => {
    setupCodeReviewMock('NEEDS_FIX');

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-2', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        project_id: projectId,
        payload: expect.objectContaining({ fix_type: 'code_review_issues' })
      })
    );
    const ivCall = mockCreateTask.mock.calls.find(c => c[0]?.task_type === 'initiative_verify');
    expect(ivCall).toBeUndefined();
  }, 10000);

  it('D3: code_review CRITICAL_BLOCK → 写入 cecelia_events initiative_pipeline_blocked', async () => {
    setupCodeReviewMock('CRITICAL_BLOCK');

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-3', status: 'AI Done', result: { decision: 'CRITICAL_BLOCK' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).not.toHaveBeenCalled();
    const eventCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_pipeline_blocked'
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][2]);
    expect(payload.alert_type).toBe('critical_block');
    expect(payload.project_id).toBe(projectId);
  }, 10000);

  it('D4: result 含 TEST_BLOCK → 写入 cecelia_events initiative_pipeline_blocked', async () => {
    setupCodeReviewMock('PASS');

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-4', status: 'AI Done', result: 'TEST_BLOCK: 集成测试失败' });

    expect(res.status).toBe(200);
    expect(mockCreateTask).not.toHaveBeenCalled();
    const eventCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_pipeline_blocked'
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][2]);
    expect(payload.alert_type).toBe('test_block');
  }, 10000);
});

// === 断链#6 测试：initiative_verify verdict 处理 ===

describe('断链#6: initiative_verify verdict 处理', () => {
  let app;
  const taskId = 'iv-task-001';
  const projectId = 'proj-initiative-002';
  const goalId = 'goal-002';

  function setupInitiativeVerifyMock({ revisionRound = 0 } = {}) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 task 信息（断链#6）
      if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'initiative_verify',
            project_id: projectId,
            goal_id: goalId,
            title: 'Initiative verify',
            payload: { revision_round: revisionRound, parent_task_id: 'cr-task-001' }
          }]
        });
      }
      // UPDATE projects
      if (typeof sql === 'string' && sql.includes('UPDATE projects') && sql.includes("status = 'completed'")) {
        return Promise.resolve({ rows: [] });
      }
      // 检查是否已有修订 dev task
      if (typeof sql === 'string' && sql.includes("LIKE '[修订]%'")) {
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

  it('D5: initiative_verify APPROVED → project status 更新为 completed', async () => {
    setupInitiativeVerifyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-5', status: 'AI Done', result: { verdict: 'APPROVED' } });

    expect(res.status).toBe(200);
    const updateCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE projects') && c[0].includes("'completed'") && c[1]?.[0] === projectId
    );
    expect(updateCall).toBeDefined();
    expect(mockCreateTask).not.toHaveBeenCalled();
  }, 10000);

  it('D6: initiative_verify NEEDS_REVISION（第1轮）→ 创建修订 dev task', async () => {
    setupInitiativeVerifyMock({ revisionRound: 0 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-6', status: 'AI Done', result: { verdict: 'NEEDS_REVISION' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        project_id: projectId,
        payload: expect.objectContaining({ fix_type: 'initiative_verify_revision', revision_round: 1 })
      })
    );
    const eventCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_max_revisions_exceeded'
    );
    expect(eventCall).toBeUndefined();
  }, 10000);

  it('D7: initiative_verify NEEDS_REVISION（第3轮，达上限）→ 写入 cecelia_events initiative_max_revisions_exceeded', async () => {
    setupInitiativeVerifyMock({ revisionRound: 3 });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-7', status: 'AI Done', result: { verdict: 'NEEDS_REVISION' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).not.toHaveBeenCalled();
    const eventCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_max_revisions_exceeded'
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][2]);
    expect(payload.project_id).toBe(projectId);
    expect(payload.revision_round).toBe(3);
  }, 10000);

  it('D8: initiative_verify REJECTED → 写入 cecelia_events initiative_rejected', async () => {
    setupInitiativeVerifyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-8', status: 'AI Done', result: { verdict: 'REJECTED' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).not.toHaveBeenCalled();
    const eventCall = mockPool.query.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events') && c[1]?.[0] === 'initiative_rejected'
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][2]);
    expect(payload.project_id).toBe(projectId);
  }, 10000);
});
