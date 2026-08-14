/**
 * dispatcher-claim-leak.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Root cause: dispatchNextTask() claims a task (claimed_by + status=in_progress)
 * then runs ~180 more lines with no top-level try/catch. Any unexpected exception
 * in that span left the task claimed + in_progress forever (no process, no graph,
 * initiative_runs=0 — because the exception fires before the graph even starts).
 *
 * This test forces the "SELECT * FROM tasks WHERE id" query (which runs right after
 * claim, before triggerCeceliaRun) to throw, and asserts the claim is released and
 * the task is marked failed instead of being left dangling.
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

describe('dispatchNextTask — claim leak on mid-flight exception (fabf6bd6)', () => {
  const TASK_ID = 'bd7e251c-0000-0000-0000-000000000001';
  const ROUTED_TASK = {
    id: TASK_ID,
    task_type: 'harness_initiative',
    title: 'harness task',
    payload: routedCodingPayload(TASK_ID),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockSelectNextDispatchableTask.mockResolvedValue({
      id: TASK_ID,
      task_type: 'harness_initiative',
      project_id: null,
      title: 'harness task that will explode',
    });
  });

  it('claim 成功后若后续查询抛异常 → claimed_by 被释放 + status 标 failed，不留在 in_progress', async () => {
    let releasedClaim = false;
    let markedFailed = false;

    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) {
        // atomic claim succeeds
        return Promise.resolve({ rows: [{ id: TASK_ID }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        // this is the query dispatchNextTask runs right after claim — force it to blow up
        return Promise.reject(new Error('simulated transient DB error'));
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaim = true;
        return Promise.resolve({ rows: [] });
      }
      if (/UPDATE tasks SET status\s*=\s*'failed'/.test(sql)) {
        markedFailed = true;
        expect(params.join(' ')).toContain(TASK_ID);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // must NOT throw/reject — must return a normal result object
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('dispatch_exception');
    expect(result.task_id).toBe(TASK_ID);
    expect(releasedClaim).toBe(true);
    expect(markedFailed).toBe(true);
  });

  it('triggerCeceliaRun 成功后若事后记账(working_memory INSERT)抛异常 → 不释放 claim / 不标 failed，dispatch 结果仍为 dispatched:true', async () => {
    let releasedClaim = false;
    let markedFailed = false;

    mockQuery.mockImplementation((sql, params) => {
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) {
        // atomic claim succeeds
        return Promise.resolve({ rows: [{ id: TASK_ID }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        // succeeds normally this time — task really gets dispatched
        return Promise.resolve({ rows: [ROUTED_TASK] });
      }
      if (/FROM work_routing_receipts receipt/.test(sql)) {
        return Promise.resolve({ rows: [canonicalRoutingReceipt(ROUTED_TASK)] });
      }
      if (/INSERT INTO working_memory/.test(sql) && params?.[0] === 'tick_last_dispatch') {
        // simulate a transient DB hiccup on the post-success dispatch-info bookkeeping insert
        return Promise.reject(new Error('simulated transient DB error on working_memory upsert'));
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaim = true;
        return Promise.resolve({ rows: [] });
      }
      if (/UPDATE tasks SET status\s*=\s*'failed'/.test(sql)) {
        markedFailed = true;
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // The dispatch already succeeded (triggerCeceliaRun.success=true) before the
    // bookkeeping insert blew up — must NOT be undone, and must NOT throw.
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(TASK_ID);
    expect(releasedClaim).toBe(false);
    expect(markedFailed).toBe(false);
  });
});
