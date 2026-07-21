import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));

const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    budgetState: { state: 'tight' },
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: true, running: 0, max: 5 },
  }),
  harnessSlotCheck: vi.fn().mockResolvedValue({
    allow: true, reason: 'ok', containers: 0, inflight: 0,
    cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false,
  }),
}));

vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: vi.fn(() => false),
  getQuotaCoolingState: vi.fn(() => ({ active: false })),
}));
vi.mock('../drain.js', () => ({
  isDraining: vi.fn(() => false),
  getDrainStartedAt: vi.fn(() => null),
}));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: vi.fn(() => true),
  recordFailure: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn() }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tick-stats.js', () => ({ incrementActionsToday: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../account-usage.js', () => ({ proactiveTokenCheck: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' }),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: vi.fn(),
  processCortexTask: vi.fn(),
}));
vi.mock('../dispatch-dedup.js', () => ({ findDuplicateSibling: vi.fn(() => null) }));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../anchor-check.js', () => ({ checkAnchor: vi.fn(() => ({ blocked: false })) }));
vi.mock('../token-budget-planner.js', () => ({
  shouldDowngrade: vi.fn((taskType, budgetState) => taskType === 'dev' && (budgetState === 'tight' || budgetState === 'critical')),
}));
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

describe('dispatcher allocation guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tight 预算下的 dev 任务 → triggerCeceliaRun 收到 payload.executor=codex', async () => {
    const task = {
      id: 'task-guided-1',
      title: 'guided dev task',
      description: 'dev task',
      task_type: 'dev',
      status: 'queued',
      priority: 'P1',
      payload: {},
      created_at: '2026-07-16T00:00:00Z',
    };

    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');
    selectNextDispatchableTask.mockResolvedValue(task);
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, taskId: task.id, runId: 'run-1' });

    mockQuery
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: task.id }] })
      .mockResolvedValueOnce({ rows: [task] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id,
      payload: expect.objectContaining({
        executor: 'codex',
        allocation: expect.objectContaining({
          selected_executor: 'codex',
          budget_state: 'tight',
        }),
      }),
    }));

    // 顶层 provider 必须与 payload.executor 同步（PR#4155 防御语义，引导员不得丢失）
    expect(mockTriggerCeceliaRun.mock.calls[0][0].provider).toBe('codex');

    // allocation 账本必须持久化回 tasks.payload（审计接缝：复盘要能从 DB 看到当时的选择依据）
    const persistCall = mockQuery.mock.calls.find(
      ([sql, params]) => typeof sql === 'string'
        && sql.includes("payload = COALESCE(payload, '{}'::jsonb)")
        && Array.isArray(params) && params[0] === task.id
    );
    expect(persistCall).toBeTruthy();
    expect(JSON.parse(persistCall[1][1])).toMatchObject({
      executor: 'codex',
      allocation: expect.objectContaining({
        selector: expect.stringContaining('dispatch-allocation-guide'),
        selected_executor: 'codex',
        budget_state: 'tight',
      }),
    });
  });
});
