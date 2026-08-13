import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalRoutingReceipt, routedCodingPayload } from './helpers/routing-receipt-fixture.js';

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
vi.mock('../llm-capacity.js', () => ({
  chooseGuidedExecutor: vi.fn((taskType, budgetState, snapshot) => {
    const vendors = snapshot?.vendors || {};
    const claudeAvailable = (vendors.claude?.available_count || 0) > 0;
    const codexAvailable = (vendors.codex?.available_count || 0) > 0;
    const grokAvailable = (vendors.grok?.available_count || 0) > 0;
    const prefersCodex = budgetState === 'tight' || budgetState === 'critical';

    if (prefersCodex && codexAvailable) return { executor: 'codex', level: 'L2_primary_codex', reason: 'primary_vendor_available' };
    if (!prefersCodex && claudeAvailable) return { executor: 'claude', level: 'L1_primary_claude', reason: 'primary_vendor_available' };
    if (!prefersCodex && codexAvailable) return { executor: 'codex', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
    if (prefersCodex && claudeAvailable) return { executor: 'claude', level: 'L3_cross_vendor_fallback', reason: 'primary_vendor_unavailable' };
    if (grokAvailable) return { executor: 'grok', level: 'L4_grok_fallback', reason: 'all_metered_vendors_unavailable' };
    return null;
  }),
  summarizeLlmCapacity: vi.fn((snapshot) => snapshot ? ({
    sampled_at: snapshot.sampled_at,
    sentinel: snapshot.sentinel,
    vendors: Object.fromEntries(Object.entries(snapshot.vendors).map(([vendor, ledger]) => [vendor, {
      available_count: ledger.available_count,
      total_count: ledger.total_count,
      poller: ledger.poller,
    }])),
  }) : null),
  getLlmCapacitySnapshot: vi.fn().mockResolvedValue({
    sampled_at: '2026-07-21T10:00:00.000Z',
    sentinel: 'ok',
    vendors: {
      claude: { available_count: 1, total_count: 2, poller: 'ok' },
      codex: { available_count: 1, total_count: 2, poller: 'ok' },
      grok: { available_count: 1, total_count: 1, poller: 'ok' },
    },
  }),
}));
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
  shouldDowngrade: vi.fn((taskType, budgetState) => ['dev', 'harness_initiative'].includes(taskType) && (budgetState === 'tight' || budgetState === 'critical')),
}));
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false }),
}));

describe('dispatcher allocation guide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tight 预算下的 routed coding 任务 → triggerCeceliaRun 收到 payload.executor=codex', async () => {
    const task = {
      id: 'task-guided-1',
      title: 'guided dev task',
      description: 'dev task',
      task_type: 'harness_initiative',
      status: 'queued',
      priority: 'P1',
      payload: routedCodingPayload('task-guided-1'),
      created_at: '2026-07-16T00:00:00Z',
    };

    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');
    selectNextDispatchableTask.mockResolvedValue(task);
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, taskId: task.id, runId: 'run-1' });

    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('UPDATE tasks SET claimed_by = $1')) return { rows: [{ id: task.id }], rowCount: 1 };
      if (String(sql).includes('SELECT * FROM tasks WHERE id = $1')) return { rows: [task], rowCount: 1 };
      if (String(sql).includes('FROM work_routing_receipts receipt')) return { rows: [canonicalRoutingReceipt(task)] };
      return { rows: [], rowCount: 1 };
    });

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

  it('harness_initiative 在 claude 无可用容量时续接到 codex', async () => {
    const task = {
      id: 'task-guided-2',
      title: 'guided harness task',
      description: 'harness task',
      task_type: 'harness_initiative',
      status: 'queued',
      priority: 'P1',
      payload: routedCodingPayload('task-guided-2'),
      created_at: '2026-07-21T00:00:00Z',
    };

    const { selectNextDispatchableTask } = await import('../dispatch-helpers.js');
    const { getLlmCapacitySnapshot } = await import('../llm-capacity.js');
    getLlmCapacitySnapshot.mockResolvedValueOnce({
      sampled_at: '2026-07-21T10:00:00.000Z',
      sentinel: 'ok',
      vendors: {
        claude: { available_count: 0, total_count: 2, poller: 'ok' },
        codex: { available_count: 1, total_count: 2, poller: 'ok' },
        grok: { available_count: 1, total_count: 1, poller: 'ok' },
      },
    });
    selectNextDispatchableTask.mockResolvedValue(task);
    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, taskId: task.id, runId: 'run-2' });

    mockQuery.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('UPDATE tasks SET claimed_by = $1')) {
        return { rows: [{ id: task.id }], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE tasks SET claimed_by = NULL')) {
        return { rows: [], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM tasks WHERE id = $1')) {
        return { rows: [task], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('FROM work_routing_receipts receipt')) {
        return { rows: [canonicalRoutingReceipt(task)], rowCount: 1 };
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = $1')) {
        return { rows: [{ id: task.id }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id,
      provider: 'codex',
      payload: expect.objectContaining({
        executor: 'codex',
        allocation: expect.objectContaining({
          continuation_level: 'L2_primary_codex',
          selected_executor: 'codex',
          reason: 'primary_vendor_available',
        }),
      }),
    }));
  });
});
