/**
 * dispatcher-harness-global-limit — 全局 harness_initiative 并发上限
 *
 * 验收：
 * - case 1: 全局已有 2 个 harness 任务 in_progress → 第 3 个被 harness_global_limit 拦截
 * - case 2: 全局仅 1 个 harness 任务 in_progress → 正常派发（不触发全局上限）
 * - case 3: dev 任务不受全局 harness 上限影响
 * - case 4: HARNESS_GLOBAL_CONCURRENCY=1 时只允许 1 并发
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) }
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));

vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));

vi.mock('../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 5 },
  })
}));

vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
  recordSuccess: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
}));
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
}));
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true })
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allowed: true })
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

const mockSelectNextDispatchableTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({}),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

// ── helper: mock 捕获 SQL 调用分类 ────────────────────────────────────────────
// - 退役 drain UPDATE → rowCount 0
// - per-project initiative lock SELECT → 传入 rows 参数
// - global count SELECT COUNT(*) → 传入 count 参数
// - claim UPDATE → rows: [{id}]
// - 其他 → rows: []
function buildQueryMock({ globalCount = 0, perProjectBlocker = null } = {}) {
  return vi.fn().mockImplementation((sql, _params) => {
    if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 });

    // 退役类型 drain
    if (/UPDATE tasks/.test(sql) && /pipeline_terminal_failure/.test(sql)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // per-project initiative lock
    if (/SELECT id, title FROM tasks/.test(sql) && /project_id/.test(sql)) {
      return Promise.resolve({
        rows: perProjectBlocker ? [perProjectBlocker] : [],
      });
    }
    // global harness concurrent count
    if (/SELECT COUNT\(\*\)/.test(sql) && /in_progress/.test(sql)) {
      return Promise.resolve({ rows: [{ count: String(globalCount) }] });
    }
    // claim UPDATE
    if (/UPDATE tasks SET claimed_by/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 'task-new' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('dispatcher harness-global-limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HARNESS_GLOBAL_CONCURRENCY;
  });

  afterEach(() => {
    delete process.env.HARNESS_GLOBAL_CONCURRENCY;
  });

  it('case 1: 全局已有 2 个 harness in_progress → harness_global_limit（默认上限=2）', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-new',
      task_type: 'harness_initiative',
      project_id: 'proj-2',
      title: 'new harness run',
    });
    mockQuery.mockImplementation(buildQueryMock({ globalCount: 2 }));

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('harness_global_limit');
    expect(result.running).toBe(2);
    expect(result.limit).toBe(2);
  });

  it('case 2: 全局只有 1 个 harness in_progress → 不触发全局上限，继续派发', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-new',
      task_type: 'harness_initiative',
      project_id: 'proj-3',
      title: 'new harness run',
    });
    mockQuery.mockImplementation(buildQueryMock({ globalCount: 1 }));

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('harness_global_limit');
  });

  it('case 3: dev 任务不受全局 harness 上限影响', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev',
      task_type: 'dev',
      project_id: 'proj-1',
      title: 'dev task',
    });
    // 即使全局已有 5 个 harness，dev 任务不走 harness 检查
    mockQuery.mockImplementation(buildQueryMock({ globalCount: 5 }));

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('harness_global_limit');

    // 确认 global count SQL 没被调用（dev 任务跳过 harness 全局上限检查）
    const globalCountCalls = mockQuery.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && /SELECT COUNT\(\*\)/.test(sql) && /in_progress/.test(sql)
    );
    expect(globalCountCalls).toHaveLength(0);
  });

  it('case 4: HARNESS_GLOBAL_CONCURRENCY=1 时，1 个并发即触发上限', async () => {
    process.env.HARNESS_GLOBAL_CONCURRENCY = '1';
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-new',
      task_type: 'harness_initiative',
      project_id: 'proj-4',
      title: 'new harness run',
    });
    mockQuery.mockImplementation(buildQueryMock({ globalCount: 1 }));

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('harness_global_limit');
    expect(result.limit).toBe(1);
  });

  it('case 5: 全局上限 SQL 在 per-project lock SQL 之后执行', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-new',
      task_type: 'harness_initiative',
      project_id: 'proj-5',
      title: 'new harness run',
    });

    const callOrder = [];
    mockQuery.mockImplementation((sql, _params) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [], rowCount: 0 });
      if (/UPDATE tasks/.test(sql) && /pipeline_terminal_failure/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/SELECT id, title FROM tasks/.test(sql) && /project_id/.test(sql)) {
        callOrder.push('per_project_lock');
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT COUNT\(\*\)/.test(sql) && /in_progress/.test(sql)) {
        callOrder.push('global_count');
        return Promise.resolve({ rows: [{ count: '3' }] }); // triggers global limit
      }
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-new' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask([]);

    const lockIdx = callOrder.indexOf('per_project_lock');
    const countIdx = callOrder.indexOf('global_count');
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(countIdx).toBeGreaterThan(lockIdx);
  });
});
