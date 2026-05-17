/**
 * Initiative Pipeline CTO 审核修复测试
 * D1: NEEDS_FIX 轮次 — fixRound=2 → 创建第3轮修复（不告警）
 * D2: NEEDS_FIX 轮次 — fixRound=3 → P0 告警（不再创建修复 task）
 * D3: NEEDS_REVISION 轮次 — revisionRound=2 → 创建第3轮修订
 * D4: NEEDS_REVISION 轮次 — revisionRound=3 → P0 告警
 * D5: TEST_BLOCK → 创建 fix_type='integration_test_failure' dev task，不写 cecelia_events
 * D6: 串行 dev task failed (seq=1) → 后续 blocked tasks (seq>1) 被 cancelled
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
// 断链#4: NEEDS_FIX 轮次修复
// ============================================================

describe('断链#4: NEEDS_FIX 轮次计算修复', () => {
  let app;
  const crTaskId = 'cr-001';
  const projectId = 'proj-001';
  const goalId = 'goal-001';

  function setupNeedsFixMock(existingFixCount) {
    mockPool.query.mockImplementation((sql, params) => {
      // code_review task 查询
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === crTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'code_review',
            project_id: projectId,
            goal_id: goalId,
            title: 'CR task',
            payload: { scope: 'initiative', initiative_id: projectId }
          }]
        });
      }
      // 历史修复轮次 COUNT
      if (typeof sql === 'string' && sql.includes("fix_type' = 'code_review_issues'")) {
        return Promise.resolve({ rows: [{ cnt: existingFixCount }] });
      }
      // 检查已有修复 task（返回空 = 没有）
      if (typeof sql === 'string' && sql.includes("LIKE '[修复]%'")) {
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

  it('D1: fixRound=2 → 创建第3轮修复 task（不告警）', async () => {
    setupNeedsFixMock(2); // 已有2个历史修复 task

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: crTaskId, run_id: 'run-1', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    // 应创建第3轮修复 task
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        payload: expect.objectContaining({ fix_type: 'code_review_issues', revision_round: 3 })
      })
    );
    // 不应写 cecelia_events 告警（不应调用 INSERT INTO cecelia_events）
    const ceceliaAlert = mockPool.query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('initiative_max_fixes_exceeded')
    );
    expect(ceceliaAlert).toBeUndefined();
  }, { timeout: 10000 });

  it('D2: fixRound=3 → P0 告警，不创建修复 task', async () => {
    setupNeedsFixMock(3); // 已有3个历史修复 task，下一轮=4 > MAX=3

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: crTaskId, run_id: 'run-2', status: 'AI Done', result: { decision: 'NEEDS_FIX' } });

    expect(res.status).toBe(200);
    // 不应创建修复 task
    const fixTaskCall = mockCreateTask.mock.calls.find(
      call => call[0]?.payload?.fix_type === 'code_review_issues'
    );
    expect(fixTaskCall).toBeUndefined();
    // 应写 P0 告警（event_type 在参数中，不在 SQL 字符串中）
    const alertCall = mockPool.query.mock.calls.find(
      call => Array.isArray(call[1]) && call[1][0] === 'initiative_max_fixes_exceeded'
    );
    expect(alertCall).toBeDefined();
  }, { timeout: 10000 });
});

// ============================================================
// 断链#6: NEEDS_REVISION 轮次修复
// ============================================================

describe('断链#6: NEEDS_REVISION 轮次计算修复', () => {
  let app;
  const ivTaskId = 'iv-001';
  const projectId = 'proj-002';
  const goalId = 'goal-002';

  function setupNeedsRevisionMock(revisionRound) {
    mockPool.query.mockImplementation((sql, params) => {
      // initiative_verify task 查询
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === ivTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'initiative_verify',
            project_id: projectId,
            goal_id: goalId,
            title: 'IV task',
            payload: { revision_round: revisionRound }
          }]
        });
      }
      // 检查已有修订 task
      if (typeof sql === 'string' && sql.includes("LIKE '[修订]%'")) {
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

  it('D3: revisionRound=2 → 创建第3轮修订 task（不告警）', async () => {
    setupNeedsRevisionMock(2);

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: ivTaskId, run_id: 'run-3', status: 'AI Done', result: { verdict: 'NEEDS_REVISION' } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        payload: expect.objectContaining({ fix_type: 'initiative_verify_revision', revision_round: 3 })
      })
    );
    // 不应告警
    const alertCall = mockPool.query.mock.calls.find(
      call => Array.isArray(call[1]) && call[1][0] === 'initiative_max_revisions_exceeded'
    );
    expect(alertCall).toBeUndefined();
  }, { timeout: 10000 });

  it('D4: revisionRound=3 → P0 告警，不创建修订 task', async () => {
    setupNeedsRevisionMock(3);

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: ivTaskId, run_id: 'run-4', status: 'AI Done', result: { verdict: 'NEEDS_REVISION' } });

    expect(res.status).toBe(200);
    const revTaskCall = mockCreateTask.mock.calls.find(
      call => call[0]?.payload?.fix_type === 'initiative_verify_revision'
    );
    expect(revTaskCall).toBeUndefined();
    // 告警的 event_type 在参数中，不在 SQL 字符串中
    const alertCall = mockPool.query.mock.calls.find(
      call => Array.isArray(call[1]) && call[1][0] === 'initiative_max_revisions_exceeded'
    );
    expect(alertCall).toBeDefined();
  }, { timeout: 10000 });
});

// ============================================================
// 断链#4: TEST_BLOCK 修复路径
// ============================================================

describe('断链#4: TEST_BLOCK → 创建修复 dev task', () => {
  let app;
  const crTaskId = 'cr-testblock-001';
  const projectId = 'proj-003';
  const goalId = 'goal-003';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockImplementation((sql, params) => {
      // code_review task 查询
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === crTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'code_review',
            project_id: projectId,
            goal_id: goalId,
            title: 'Initiative CR (test block)',
            payload: { scope: 'initiative', initiative_id: projectId }
          }]
        });
      }
      // 检查已有集成测试修复 task（返回空 = 没有）
      if (typeof sql === 'string' && sql.includes("'integration_test_failure'")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes.js?v=' + Date.now());
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('D5: TEST_BLOCK → 创建 fix_type=integration_test_failure dev task，不写 P0 cecelia_events 告警', async () => {
    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({
        task_id: crTaskId,
        run_id: 'run-5',
        status: 'AI Done',
        result: { decision: 'PASS', findings: '[TEST_BLOCK] 集成测试失败：npm test 超时' }
      });

    expect(res.status).toBe(200);
    // 应创建集成测试修复 task
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        priority: 'P0',
        payload: expect.objectContaining({ fix_type: 'integration_test_failure' })
      })
    );
    // 不应写 initiative_pipeline_blocked 告警（TEST_BLOCK 不再走 P0 告警路径）
    const pipelineBlockedAlert = mockPool.query.mock.calls.find(
      call => typeof call[0] === 'string' && call[0].includes('initiative_pipeline_blocked')
    );
    expect(pipelineBlockedAlert).toBeUndefined();
  }, { timeout: 10000 });
});

// ============================================================
// 断链#5c12: 串行 task 失败 → 取消后续 blocked tasks
// ============================================================

describe('断链#5c12: 串行 task 失败降级', () => {
  let app;
  const failedTaskId = 'dev-seq1-001';
  const projectId = 'proj-004';

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPool.query.mockImplementation((sql, params) => {
      // 失败 task 查询（5c12 降级 + 其他断链查询）
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === failedTaskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'dev',
            project_id: projectId,
            goal_id: 'goal-004',
            title: 'Dev Task Seq 1',
            payload: { sequence_order: 1, depends_on_prev: 'false' }
          }]
        });
      }
      // UPDATE cancelled 返回（模拟取消了2个后续 task）
      if (typeof sql === 'string' && sql.includes("status = 'cancelled'") && sql.includes('sequence_order')) {
        return Promise.resolve({ rows: [{ id: 'dev-seq2-001' }, { id: 'dev-seq3-001' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    mockClient.query.mockResolvedValue({ rows: [] });
    const { default: router } = await import('../routes.js?v=' + Date.now());
    app = express();
    app.use(express.json());
    app.use('/api/brain', router);
  });

  it('D6: dev task (seq=1) failed → 后续 blocked tasks (seq>1) 被 UPDATE 为 cancelled', async () => {
    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: failedTaskId, run_id: 'run-6', status: 'AI Failed' }); // 'AI Failed' → newStatus='failed'

    expect(res.status).toBe(200);
    // 应有 UPDATE ... SET status='cancelled' 的调用
    const cancelCall = mockPool.query.mock.calls.find(
      call => typeof call[0] === 'string' &&
        call[0].includes("status = 'cancelled'") &&
        call[0].includes('sequence_order') &&
        call[0].includes('blocked')
    );
    expect(cancelCall).toBeDefined();
  }, { timeout: 10000 });
});
