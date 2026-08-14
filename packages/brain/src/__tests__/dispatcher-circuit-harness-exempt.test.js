/**
 * dispatcher-circuit-harness-exempt — 熔断器豁免 harness_initiative
 *
 * 验收：
 * - case 1: harness_initiative + 熔断 OPEN → dispatched（不被拦截）
 * - case 2: dev task + 熔断 OPEN → circuit_breaker_open
 * - case 3: harness_initiative + 熔断 CLOSED → dispatched（正常路径不受影响）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalRoutingReceipt, routedCodingPayload } from './helpers/routing-receipt-fixture.js';

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

const mockTriggerCeceliaRun = vi.fn().mockResolvedValue({ success: true, pid: 12345 });
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
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
  }),
  harnessSlotCheck: vi.fn().mockResolvedValue({
    allow: true,
    reason: null,
    containers: 0,
    inflight: 0,
    cap: { effective: 4, mem_cap: 4, acct_cap: 4, hard_cap: 4 },
    stale: false,
  }),
}));

vi.mock('../token-budget-planner.js', () => ({ shouldDowngrade: vi.fn(() => false) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const mockIsAllowed = vi.fn(() => true);
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
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

// 让 SELECT * FROM tasks + UPDATE claimed_by 正常返回，使 dispatch 到达 triggerCeceliaRun
function makeHarnessQueryMock(taskId) {
  const task = {
    id: taskId,
    task_type: 'harness_initiative',
    title: 'harness sprint',
    payload: routedCodingPayload(taskId),
  };
  return (sql) => {
    if (/UPDATE tasks SET claimed_by/.test(sql)) {
      return Promise.resolve({ rows: [{ id: taskId }] });
    }
    if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
      return Promise.resolve({ rows: [task] });
    }
    if (/FROM work_routing_receipts receipt/.test(sql)) {
      return Promise.resolve({ rows: [canonicalRoutingReceipt(task)] });
    }
    if (/count\(\*\)/i.test(sql) && /harness_initiative/.test(sql)) {
      return Promise.resolve({ rows: [{ n: 0 }] }); // cap not reached
    }
    return Promise.resolve({ rows: [] });
  };
}

describe('dispatcher circuit-breaker — harness_initiative 豁免', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    mockIsAllowed.mockReturnValue(true);
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 12345 });
  });

  it('case 1: harness_initiative + 熔断 OPEN → dispatched（不被拦截）', async () => {
    mockIsAllowed.mockReturnValue(false); // 熔断 OPEN
    mockQuery.mockImplementation(makeHarnessQueryMock('task-harness-1'));

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-harness-1',
      task_type: 'harness_initiative',
      project_id: 'proj-1',
      title: 'harness sprint',
      payload: routedCodingPayload('task-harness-1'),
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.reason).not.toBe('circuit_breaker_open');
    expect(result.dispatched).toBe(true);
  });

  it('case 2: dev task + 熔断 OPEN → circuit_breaker_open', async () => {
    mockIsAllowed.mockReturnValue(false); // 熔断 OPEN

    // 让 atomic claim (UPDATE...RETURNING id) 成功，才能走到 circuit breaker 检查
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-dev-1' }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'task-dev-1', task_type: 'dev', title: 'dev task' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-dev-1',
      task_type: 'dev',
      project_id: 'proj-1',
      title: 'dev task',
      created_at: '2026-07-16T00:00:00Z',
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('circuit_breaker_open');
  });

  it('case 3: harness_initiative + 熔断 CLOSED → dispatched（正常流程不受影响）', async () => {
    mockIsAllowed.mockReturnValue(true); // 熔断 CLOSED
    mockQuery.mockImplementation(makeHarnessQueryMock('task-harness-2'));

    mockSelectNextDispatchableTask.mockResolvedValue({
      id: 'task-harness-2',
      task_type: 'harness_initiative',
      project_id: 'proj-2',
      title: 'harness sprint 2',
      payload: routedCodingPayload('task-harness-2'),
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
  });
});
