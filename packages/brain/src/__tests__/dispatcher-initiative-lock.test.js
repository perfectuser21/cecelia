/**
 * dispatcher-initiative-lock — initiative lock 收紧到 harness 类型
 *
 * 验收：
 * - case 1: 同 project_id 有 harness_task in_progress → 同 project_id 的 harness_task 被锁
 * - case 2: 同 project_id 有 harness_task in_progress → 同 project_id 的 dev task 不查 lock，不锁
 * - case 3: 同 project_id 有 dev task in_progress → 同 project_id 的 harness_task 因 SQL 过滤不锁
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

describe('dispatcher initiative-lock — task_type 白名单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('case 1: harness_task vs harness_task same project → initiative_locked', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-A',
      task_type: 'harness_task',
      project_id: 'proj-1',
      title: 'A',
    });
    mockQuery.mockImplementation((sql) => {
      if (/SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-B', title: 'blocker harness' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('initiative_locked');
    expect(result.blocking_task_id).toBe('task-B');
  });

  it('case 2: dev task vs harness blocker same project → 不查 lock SQL，不 initiative_locked', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev',
      task_type: 'dev',
      project_id: 'proj-1',
      title: 'dev',
    });
    mockQuery.mockResolvedValue({ rows: [] });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('initiative_locked');

    // 关键断言：lock check SQL（含 task_type 白名单 + project_id）不应被调用
    const lockCheckCalls = mockQuery.mock.calls.filter(([sql]) =>
      typeof sql === 'string' && /SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)
    );
    expect(lockCheckCalls).toHaveLength(0);
  });

  it('case 3: harness_task vs dev blocker → SQL 含 task_type=ANY 过滤，参数含 6 项白名单', async () => {
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-H',
      task_type: 'harness_task',
      project_id: 'proj-1',
      title: 'harness',
    });
    let lockCheckSql = null;
    let lockCheckParams = null;
    mockQuery.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && /SELECT id, title FROM tasks/.test(sql) && /task_type/.test(sql)) {
        lockCheckSql = sql;
        lockCheckParams = params;
        return Promise.resolve({ rows: [] }); // dev blocker 被 SQL 过滤
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(lockCheckSql).toMatch(/task_type\s*=\s*ANY/i);
    expect(lockCheckParams[2]).toEqual(expect.arrayContaining([
      'harness_task',
      'harness_planner',
      'harness_contract_propose',
      'harness_contract_review',
      'harness_fix',
      'harness_initiative',
    ]));
    expect(result.reason).not.toBe('initiative_locked');
  });
});
