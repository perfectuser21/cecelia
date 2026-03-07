/**
 * Dev Failure Retry Routes Tests
 *
 * 验收对应 DoD D2-D6：
 * - D2: failed dev 任务调用分类器
 * - D3: transient/code_error + retry_count < 3 → 重排为 queued
 * - D4: auth/resource → 保持 failed，不重排
 * - D5: 重排 payload 含 previous_failure 和 retry_reason
 * - D6: completed_no_pr 重排逻辑不受影响
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mock setup（必须在 import routes 之前）
// ============================================================

const mockClient = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  release: vi.fn(),
};
const mockPool = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  connect: vi.fn().mockResolvedValue(mockClient),
};

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
  addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(),
  getPendingQuestions: vi.fn(),
  OKR_STATUS: {},
}));
vi.mock('../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn(),
}));
vi.mock('../embedding.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({ level: 'L0', actions: [{ type: 'fallback_to_tick' }] })),
  executeDecision: vi.fn(async () => {}),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
  ACTION_WHITELIST: [],
}));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn(async () => {}),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(),
  reset: vi.fn(),
  getAllStates: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock('../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(async () => {}),
  notifyTaskFailed: vi.fn(async () => {}),
}));
vi.mock('../progress-ledger.js', () => ({
  recordProgressStep: vi.fn(async () => {}),
}));
vi.mock('../proactive-mouth.js', () => ({
  notifyTaskCompletion: vi.fn(async () => {}),
}));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(async () => ({ content: '' })),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(async () => {}),
  getQuarantinedTasks: vi.fn(async () => []),
  getQuarantineStats: vi.fn(async () => ({})),
  releaseTask: vi.fn(async () => {}),
  quarantineTask: vi.fn(async () => {}),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
  classifyFailure: vi.fn(() => ({ class: 'task_error', retry_strategy: { should_retry: false } })),
}));

// Import router after mocks
const { default: router } = await import('../routes.js');

// ============================================================
// 辅助：模拟 express 请求/响应
// ============================================================

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
      const routePath = layer.route.path;
      const routeMethod = Object.keys(layer.route.methods)[0];
      return routePath === path && routeMethod === method.toLowerCase();
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

// ============================================================
// 辅助：获取所有设置为 queued 的 pool.query 调用
// ============================================================

function getQueuedUpdateCalls() {
  return mockPool.query.mock.calls.filter(c =>
    typeof c[0] === 'string' && c[0].includes("status = 'queued'") && c[0].includes('retry_count = retry_count + 1')
  );
}

// ============================================================
// D3: transient failure → reschedule queued
// ============================================================

describe('D3: transient failure → reschedule queued', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 为 P1-3 SELECT task_type/retry_count 查询配置默认行为
    // mockPool.query 的调用顺序由测试自行配置
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('retry_count=0, transient → 重排 queued, next_run_at=now+5min, payload 含 previous_failure', async () => {
    // P1-3 SELECT 返回 dev 任务，retry_count=0
    mockPool.query.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const before = Date.now();
    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-retry-0',
      run_id: 'run-1',
      status: 'AI Failed',
      result: { result: 'network timeout after 30s' },
      duration_ms: 5000,
    });

    expect(result.statusCode).toBe(200);

    const queuedCalls = getQueuedUpdateCalls();
    expect(queuedCalls.length).toBe(1);

    const params = queuedCalls[0][1];
    expect(params[0]).toBe('task-retry-0');

    // next_run_at ≈ now + 5min
    const nextRunAt = new Date(params[1]);
    expect(nextRunAt.getTime()).toBeGreaterThan(before + 4 * 60 * 1000);
    expect(nextRunAt.getTime()).toBeLessThan(before + 6 * 60 * 1000);

    // previous_failure 结构
    const previousFailure = JSON.parse(params[2]);
    expect(previousFailure).toHaveProperty('class', 'transient');
    expect(previousFailure).toHaveProperty('reason');
    expect(previousFailure).toHaveProperty('failed_at');

    // retry_reason
    expect(typeof params[3]).toBe('string');
    expect(params[3].length).toBeGreaterThan(0);
  });

  it('retry_count=1, code_error → next_run_at=now+10min', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 1 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const before = Date.now();
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-retry-1',
      run_id: 'run-2',
      status: 'AI Failed',
      result: { result: 'TypeScript compilation error: type mismatch' },
      duration_ms: 3000,
    });

    const queuedCalls = getQueuedUpdateCalls();
    expect(queuedCalls.length).toBe(1);

    const nextRunAt = new Date(queuedCalls[0][1][1]);
    expect(nextRunAt.getTime()).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(nextRunAt.getTime()).toBeLessThan(before + 11 * 60 * 1000);

    const previousFailure = JSON.parse(queuedCalls[0][1][2]);
    expect(previousFailure.class).toBe('code_error');
  });

  it('retry_count=2, transient → next_run_at=now+15min', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 2 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const before = Date.now();
    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-retry-2',
      run_id: 'run-3',
      status: 'AI Failed',
      result: { result: 'CI check failed: brain-ci timeout' },
      duration_ms: 3000,
    });

    const queuedCalls = getQueuedUpdateCalls();
    expect(queuedCalls.length).toBe(1);

    const nextRunAt = new Date(queuedCalls[0][1][1]);
    expect(nextRunAt.getTime()).toBeGreaterThan(before + 14 * 60 * 1000);
    expect(nextRunAt.getTime()).toBeLessThan(before + 16 * 60 * 1000);
  });

  it('retry_count=3 (MAX_DEV_RETRY 已达上限) → 不重排', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 3 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-max-retry',
      run_id: 'run-max',
      status: 'AI Failed',
      result: { result: 'network timeout' },
      duration_ms: 3000,
    });

    const queuedCalls = getQueuedUpdateCalls();
    expect(queuedCalls.length).toBe(0);
  });
});

// ============================================================
// D4: auth/resource → 不重排
// ============================================================

describe('D4: auth/resource → 不重排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('auth 失败（permission denied）→ 不重排', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-auth',
      run_id: 'run-auth',
      status: 'AI Failed',
      result: { result: 'permission denied to push to repository' },
      duration_ms: 1000,
    });

    expect(getQueuedUpdateCalls().length).toBe(0);
  });

  it('auth 失败（token expired）→ 不重排，任意 retry_count', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 1 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-token',
      run_id: 'run-token',
      status: 'AI Failed',
      result: { result: 'token expired, please re-authenticate' },
      duration_ms: 1000,
    });

    expect(getQueuedUpdateCalls().length).toBe(0);
  });

  it('resource 失败（disk full）→ 不重排', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-disk',
      run_id: 'run-disk',
      status: 'AI Failed',
      result: { result: 'disk full ENOSPC' },
      duration_ms: 1000,
    });

    expect(getQueuedUpdateCalls().length).toBe(0);
  });

  it('resource 失败（out of memory）→ 不重排', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-oom',
      run_id: 'run-oom',
      status: 'AI Failed',
      result: { result: 'out of memory: kill process' },
      duration_ms: 1000,
    });

    expect(getQueuedUpdateCalls().length).toBe(0);
  });
});

// ============================================================
// D2: 非 dev 任务 → 不重排
// ============================================================

describe('D2: 非 dev 任务失败不重排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('research 任务 failed → 不调用重排逻辑', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'research', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-research',
      run_id: 'run-research',
      status: 'AI Failed',
      result: { result: 'network timeout' },
      duration_ms: 1000,
    });

    expect(getQueuedUpdateCalls().length).toBe(0);
  });
});

// ============================================================
// D5: 重排 payload 含 previous_failure 和 retry_reason
// ============================================================

describe('D5: 重排 payload 结构', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('previous_failure 包含 class, reason, result_summary, failed_at', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('task_type, retry_count')) {
        return { rows: [{ task_type: 'dev', retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-payload',
      run_id: 'run-payload',
      status: 'AI Failed',
      result: { result: 'ECONNRESET on git push' },
      duration_ms: 2000,
    });

    const queuedCalls = getQueuedUpdateCalls();
    expect(queuedCalls.length).toBe(1);

    const params = queuedCalls[0][1];
    const previousFailure = JSON.parse(params[2]);

    expect(previousFailure).toHaveProperty('class');
    expect(previousFailure).toHaveProperty('reason');
    expect(previousFailure).toHaveProperty('result_summary');
    expect(previousFailure).toHaveProperty('failed_at');
    expect(previousFailure.class).toBe('transient');
    expect(typeof previousFailure.result_summary).toBe('string');

    // retry_reason (params[3])
    expect(typeof params[3]).toBe('string');
    expect(params[3].length).toBeGreaterThan(0);
  });
});

// ============================================================
// D6: completed_no_pr 重排逻辑不受影响
// ============================================================

describe('D6: completed_no_pr 重排逻辑不受影响', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('completed_no_pr → 不触发 P1-3 dev retry 逻辑', async () => {
    mockPool.query.mockImplementation(async (sql) => {
      // P1-1: check task_type for completed_no_pr
      if (typeof sql === 'string' && sql.includes('task_type, payload')) {
        return { rows: [{ task_type: 'dev', payload: {} }] };
      }
      // P1-2: retry_count for completed_no_pr
      if (typeof sql === 'string' && sql.includes('retry_count') && !sql.includes('task_type, retry_count')) {
        return { rows: [{ retry_count: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await mockReqRes('POST', '/execution-callback', {
      task_id: 'task-no-pr',
      run_id: 'run-no-pr',
      status: 'AI Done',
      result: { result: 'success' },
      duration_ms: 5000,
      pr_url: undefined,  // no PR → completed_no_pr
    });

    expect(result.statusCode).toBe(200);

    // P1-3 的 SELECT 不应该被调用（P1-3 只在 newStatus==='failed' 时触发）
    const p13Calls = mockPool.query.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('task_type, retry_count')
    );
    expect(p13Calls.length).toBe(0);
  });
});
