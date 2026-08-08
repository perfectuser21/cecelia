/**
 * callback-error-message-fallback.test.js
 *
 * 验证 attempt 单结算：当任务已被 watchdog 终态化、execution callback 后到达时，
 * 主 UPDATE compare-and-set 不匹配，回调必须立即结束，不能再写分类或触发重试。
 *
 * 根因：若任务在 callback 到达前已非 in_progress（watchdog 改状态），
 * 主 UPDATE 跳过，error_message 保持 NULL，无法诊断失败原因。
 * 修复：主 UPDATE rowCount=0 后提交并返回 duplicate，终止全部下游副作用。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool — hoisted 确保 routes 加载时获得同一实例
const mockClient = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const mockPool = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(() => mockClient),
}));
vi.mock('../db.js', () => ({ default: mockPool }));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  removeActiveProcess: vi.fn(),
  probeTaskLiveness: vi.fn(async () => []),
  syncOrphanTasksOnStartup: vi.fn(async () => ({ orphans_found: 0, orphans_fixed: 0, rebuilt: 0 })),
  recordHeartbeat: vi.fn(async () => ({ success: true })),
}));
vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(),
  LOCATION_MAP: {},
}));
vi.mock('../okr-tick.js', () => ({
  executeOkrTick: vi.fn(),
  runOkrTickSafe: vi.fn(),
  startOkrTickLoop: vi.fn(),
  stopOkrTickLoop: vi.fn(),
  getOkrTickStatus: vi.fn(),
  OKR_STATUS: {},
  addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(),
  getPendingQuestions: vi.fn(),
}));
vi.mock('../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn(),
  getDailyReports: vi.fn(),
}));
vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(),
  parseAndCreate: vi.fn(),
  INTENT_TYPES: {},
  INTENT_ACTION_MAP: {},
  extractEntities: vi.fn(),
  classifyIntent: vi.fn(),
  getSuggestedAction: vi.fn(),
}));
vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));
vi.mock('../decision.js', () => ({
  logDecision: vi.fn(),
  getRecentDecisions: vi.fn(),
  getActiveDecisions: vi.fn(),
}));
vi.mock('../desire-feedback.js', () => ({
  processFeedback: vi.fn(),
  getFeedbackStats: vi.fn(),
}));
vi.mock('../auto-learning.js', () => ({
  processExecutionAutoLearning: vi.fn(),
}));
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn(() => ({ p2_paused: false })),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn(),
  getDispatchStats: vi.fn(),
}));
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn(async () => ({ passed: true, issues: [], suggestions: [] })),
  getPreFlightStats: vi.fn(async () => ({})),
  alertOnPreFlightFail: vi.fn(async () => undefined),
}));
vi.mock('../ws.js', () => ({
  publishCognitiveState: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
  getActiveSessions: vi.fn(() => []),
}));
vi.mock('../emit.js', () => ({
  emitEvent: vi.fn(),
  emit: vi.fn(),
}));

// Load router after all mocks are set
const mod = await import('../routes.js');
const router = mod.default || mod.router;

function mockReqRes(method, path, body = {}) {
  return new Promise((resolve) => {
    const req = { method, path, body, query: {}, params: {} };
    const resData = { statusCode: 200, body: null };
    const res = {
      status: (code) => { resData.statusCode = code; return res; },
      json: (data) => { resData.body = data; resolve(resData); },
    };

    const layers = router.stack.filter(layer => {
      if (!layer.route) return false;
      return layer.route.path === path && Object.keys(layer.route.methods)[0] === method.toLowerCase();
    });

    if (layers.length === 0) {
      resolve({ statusCode: 404, body: { error: 'Not found' } });
      return;
    }

    const handler = layers[0].route.stack[0].handle;
    handler(req, res).catch(err => {
      resData.statusCode = 500;
      resData.body = { error: err.message };
      resolve(resData);
    });
  });
}

describe('callback compare-and-set 终态防重', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('decision_log')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // 任务查询返回基本信息
      return Promise.resolve({ rows: [{ goal_id: null, task_type: 'dev', payload: {}, status: 'quarantined' }], rowCount: 1 });
    });
  });

  it('E1: 主 UPDATE 未应用时返回 duplicate，且不写分类 payload', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-watchdog-race',
      run_id: 'run-001',
      status: 'AI Failed',
      result: {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        num_turns: 0,
        stop_reason: null,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    expect(response.body).toMatchObject({ success: true, duplicate: true });
    const allPoolCalls = mockPool.query.mock.calls;
    const classificationUpdate = allPoolCalls.find(c =>
      typeof c[0] === 'string' &&
      c[0].includes('COALESCE(error_message,') &&
      c[0].includes('UPDATE tasks')
    );

    expect(classificationUpdate).toBeUndefined();
  });

  it('E2: 迟到失败回调不执行隔离与分类副作用', async () => {
    const response = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-watchdog-race-2',
      run_id: 'run-002',
      status: 'AI Failed',
      result: {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        num_turns: 0,
        total_cost_usd: 0,
        usage: {},
      },
    });

    expect(response.body.reason).toBe('callback_compare_and_set_rejected');
    expect(mockPool.query.mock.calls.some(c =>
      typeof c[0] === 'string' && c[0].includes('COALESCE(error_message,')
    )).toBe(false);
  });

  it('E3: 主 UPDATE 已写 error_message 时 COALESCE 不覆盖（幂等性）', async () => {
    // 验证 SQL 使用 COALESCE(error_message, $3) 而非直接赋值
    // 这确保已有 error_message 不被覆盖
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { join, dirname } = await import('path');
    const _dirname = dirname(fileURLToPath(import.meta.url));
    const execJsPath = join(_dirname, '../routes/execution.js');
    const src = readFileSync(execJsPath, 'utf8');

    // 检查分类 UPDATE 使用 COALESCE 而非直接赋值
    expect(src).toContain('COALESCE(error_message,');
    // 确认是在 failure_class 赋值的同一 UPDATE 中
    const classifyUpdateIdx = src.indexOf('failure_class: classification.class');
    const coalesceIdx = src.indexOf('COALESCE(error_message,');
    // COALESCE 应在 failure_class 赋值附近（500字符内）
    expect(Math.abs(classifyUpdateIdx - coalesceIdx)).toBeLessThan(500);
  });
});
