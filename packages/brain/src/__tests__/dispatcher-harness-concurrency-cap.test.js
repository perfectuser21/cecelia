/**
 * dispatcher-harness-concurrency-cap — 全局 harness_initiative 并发上限（OPEN-1 OOM 防线）
 *
 * 根因：dispatcher 只有 project-scoped initiative lock（同 project 才挡），
 * 没有全局 harness_initiative 并发上限。null/跨 project 的 harness_initiative 会无限叠加，
 * 每条 graph spawn pipeline-heavy(2GB) 的 planner/GAN agent，4-5 条并发撑爆 13.6GB OrbStack VM
 * → docker OOM_killed (exit=137)。
 *
 * 验收：
 * - case 1: 已有 MAX 条 harness_initiative in_progress → 新 harness_initiative 被 cap，
 *           reason='harness_concurrency_capped'，不派发。
 * - case 2: 在 cap 以下（running < MAX）→ harness_initiative 正常派发。
 * - case 3: cap 只作用于 harness_initiative；dev task 不查 cap count SQL。
 * - case 4: pure predicate harnessConcurrencyExceeded(running, max) 边界正确。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, pid: 12345, runId: 'run-1' }),
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
    budgetState: { state: 'abundant' },
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
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true })
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

// SQL 识别：全局 harness 并发计数 query（count(*) + harness_initiative + in_progress）
function isHarnessCapCountSql(sql) {
  return typeof sql === 'string'
    && /count\(\*\)/i.test(sql)
    && /harness_initiative/.test(sql)
    && /in_progress/.test(sql);
}

describe('dispatcher — 全局 harness_initiative 并发上限', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('case 1: 已达并发上限 → harness_concurrency_capped，不派发', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-H',
      task_type: 'harness_initiative',
      project_id: null,
      title: 'new harness',
    });
    mockQuery.mockImplementation((sql) => {
      if (isHarnessCapCountSql(sql)) {
        return Promise.resolve({ rows: [{ n: 2 }] }); // 已达默认 MAX=2
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('harness_concurrency_capped');
    expect(result.running).toBe(2);
  });

  it('case 2: 并发数低于上限 → harness_initiative 正常派发', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-H2',
      task_type: 'harness_initiative',
      project_id: null,
      title: 'harness ok',
    });
    mockQuery.mockImplementation((sql) => {
      if (isHarnessCapCountSql(sql)) {
        return Promise.resolve({ rows: [{ n: 1 }] }); // 1 < 2
      }
      // 原子 claim UPDATE 必须返回一行，否则走 already_claimed 分支
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-H2' }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-H2', task_type: 'harness_initiative', title: 'harness ok' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('harness_concurrency_capped');
    expect(result.dispatched).toBe(true);
  });

  it('case 3: dev task 不受全局 harness cap 影响（不查 cap count SQL）', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev',
      task_type: 'dev',
      project_id: null,
      title: 'dev',
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('harness_concurrency_capped');
    const capCalls = mockQuery.mock.calls.filter(([sql]) => isHarnessCapCountSql(sql));
    expect(capCalls).toHaveLength(0);
  });

  it('case 4: pure predicate harnessConcurrencyExceeded 边界', async () => {
    const { harnessConcurrencyExceeded, MAX_CONCURRENT_HARNESS_INITIATIVES } = await import('../dispatcher.js');
    expect(MAX_CONCURRENT_HARNESS_INITIATIVES).toBeGreaterThanOrEqual(1);
    expect(harnessConcurrencyExceeded(MAX_CONCURRENT_HARNESS_INITIATIVES, MAX_CONCURRENT_HARNESS_INITIATIVES)).toBe(true);
    expect(harnessConcurrencyExceeded(MAX_CONCURRENT_HARNESS_INITIATIVES - 1, MAX_CONCURRENT_HARNESS_INITIATIVES)).toBe(false);
    expect(harnessConcurrencyExceeded(MAX_CONCURRENT_HARNESS_INITIATIVES + 1, MAX_CONCURRENT_HARNESS_INITIATIVES)).toBe(true);
  });
});
