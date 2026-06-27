/**
 * 漏点④：daily code_review 巡检发现 bug → 自动立案修复 dev task
 *
 * 背景：daily-review-scheduler 每日为活跃 repo 建 code_review 任务（payload.scope='daily'，无 project_id）。
 * 此前 execution.js code_review 路由只处理 scope='initiative'，daily-scope 命中 else-if 后只打日志 skip，
 * 发现的 bug 被丢弃（开环漏点④）。本测试验证 daily-scope code_review 完成后按 decision 自动建修复 task。
 *
 * D1: NEEDS_FIX → 建 P1 修复 dev task（带 repo_path / fix_type='daily_review_issues'）
 * D2: CRITICAL_BLOCK → 建 P0 修复 dev task
 * D3: PASS（无 L1/L2）→ 不建 task
 * D4: PASS 但 l1_count>0（decision 与计数不一致时以严重度优先）→ 建 P0 修复 task
 * D5: 幂等 — 已有未完成的 daily 修复 task → 不重复建
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

const mockCreateTask = vi.fn().mockResolvedValue({ success: true, task: { id: 'new-fix-task-id' } });
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
vi.mock('../suggestion-dispatcher.js', () => ({ dispatchSuggestion: vi.fn(async () => {}) }));
vi.mock('../dep-cascade.js', () => ({ propagateDependencyFailure: vi.fn(async () => ({ affected: [] })), recoverDependencyChain: vi.fn(async () => ({ recovered: [] })) }));

import express from 'express';
import request from 'supertest';

describe('漏点④: daily code_review 巡检发现 bug 自动立案', () => {
  let app;
  const taskId = 'daily-cr-001';
  const repoPath = '/Users/administrator/perfect21/cecelia';

  // existingDailyFix=true 时模拟「已有未完成 daily 修复 task」
  function setupDailyMock({ existingDailyFix = false } = {}) {
    mockPool.query.mockImplementation((sql, params) => {
      // 查询 code_review task 信息（daily scope，无 project_id / goal_id）
      if (typeof sql === 'string' && sql.includes('task_type') && params?.[0] === taskId) {
        return Promise.resolve({
          rows: [{
            task_type: 'code_review',
            project_id: null,
            goal_id: null,
            title: '[code-review] cecelia 2026-06-20',
            payload: { scope: 'daily', repo_path: repoPath, since_hours: 24 },
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

  it('D1: NEEDS_FIX → 建 P1 修复 dev task（带 repo_path + fix_type=daily_review_issues）', async () => {
    setupDailyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-1', status: 'AI Done', result: { decision: 'NEEDS_FIX', l1_count: 0, l2_count: 3 } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        priority: 'P1',
        trigger_source: 'auto_fix',
        payload: expect.objectContaining({ fix_type: 'daily_review_issues', repo_path: repoPath, code_review_task_id: taskId }),
      })
    );
  }, 10000);

  it('D2: CRITICAL_BLOCK → 建 P0 修复 dev task', async () => {
    setupDailyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-2', status: 'AI Done', result: { decision: 'CRITICAL_BLOCK', l1_count: 2, l2_count: 1 } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        priority: 'P0',
        payload: expect.objectContaining({ fix_type: 'daily_review_issues', repo_path: repoPath }),
      })
    );
  }, 10000);

  it('D3: PASS（无 L1/L2）→ 不建 task', async () => {
    setupDailyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-3', status: 'AI Done', result: { decision: 'PASS', l1_count: 0, l2_count: 0 } });

    expect(res.status).toBe(200);
    const devCall = mockCreateTask.mock.calls.find(c => c[0]?.payload?.fix_type === 'daily_review_issues');
    expect(devCall).toBeUndefined();
  }, 10000);

  it('D4: decision=PASS 但 l1_count>0（计数与 decision 不一致）→ 仍建 P0 修复 task（以严重度优先）', async () => {
    setupDailyMock();

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-4', status: 'AI Done', result: { decision: 'PASS', l1_count: 1, l2_count: 0 } });

    expect(res.status).toBe(200);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dev',
        priority: 'P0',
        payload: expect.objectContaining({ fix_type: 'daily_review_issues' }),
      })
    );
  }, 10000);

  it('D5: 幂等 — 已有未完成 daily 修复 task → 不重复建', async () => {
    setupDailyMock({ existingDailyFix: true });

    const res = await request(app)
      .post('/api/brain/execution-callback')
      .send({ task_id: taskId, run_id: 'run-5', status: 'AI Done', result: { decision: 'NEEDS_FIX', l1_count: 0, l2_count: 2 } });

    expect(res.status).toBe(200);
    const devCall = mockCreateTask.mock.calls.find(c => c[0]?.payload?.fix_type === 'daily_review_issues');
    expect(devCall).toBeUndefined();
  }, 10000);
});
