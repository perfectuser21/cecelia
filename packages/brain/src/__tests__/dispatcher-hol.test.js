/**
 * dispatcher-hol.test.js — Head-of-Line Blocking Fix
 *
 * 问题：队首 codex 任务（codex_dev/codex_qa/codex_test_gen）派不出时
 * dispatcher 直接返回 codex_pool_full，永远不尝试队列后面的 claude 类任务。
 *
 * 修复：检测到队首因 codex pool 不可用被阻塞时，跳过该任务继续找下一个
 * 可派发的非 codex 任务，最多跳过 MAX_SKIP_HEAD_FOR_BLOCKED=10 次。
 *
 * 验收：
 * - C1: 队首 codex task + codex pool 不可用 + 第二位 claude dev task → 派第二位
 * - C2: 队首 P0 codex task + codex pool 不可用 → 全停，不绕过 P0
 * - C3: skip cap 触发（全是 codex task + codex 不可用）→ reason='hol_skip_cap_exceeded'
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
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: true, runId: 'run-hol-1', pid: 12345 }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  killProcessTwoStage: vi.fn(),
  getBillingPause: vi.fn(() => ({ active: false })),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
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
  checkQuotaGuard: vi.fn().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 }),
}));
vi.mock('../actions.js', () => ({
  updateTask: vi.fn().mockResolvedValue({ success: true }),
  createTask: vi.fn(),
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({}),
  alertOnPreFlightFail: vi.fn().mockResolvedValue(undefined),
}));

const mockSelectNextDispatchableTask = vi.fn();
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(),
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(),
  shouldBypassBackpressure: vi.fn(() => false),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeSlotBudget({ codexAvailable = true } = {}) {
  return {
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
    codex: { available: codexAvailable, running: codexAvailable ? 0 : 3, max: 3 },
    budgetState: { state: 'abundant' },
  };
}

function makeCodexTask(id = 'codex-1', priority = 'P1') {
  return { id, task_type: 'codex_dev', priority, title: `Codex task ${id}`, payload: {} };
}

function makeClaudeTask(id = 'claude-1', priority = 'P1') {
  return { id, task_type: 'dev', priority, title: `Claude task ${id}`, payload: {}, project_id: null };
}

function setupQueryMocks(dispatchedTaskId) {
  mockQuery.mockImplementation((sql) => {
    if (/UPDATE tasks.*pipeline_terminal_failure/.test(sql)) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (/UPDATE tasks SET claimed_by/.test(sql)) {
      return Promise.resolve({ rows: [{ id: dispatchedTaskId }] });
    }
    if (/SELECT id, title FROM tasks.*task_type/.test(sql)) {
      return Promise.resolve({ rows: [] });
    }
    if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
      return Promise.resolve({ rows: [{ id: dispatchedTaskId, task_type: 'dev', payload: {}, priority: 'P1', title: 'Claude task' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('dispatcher HOL blocking fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it('C1: 队首 codex task (P1) + codex pool 满 + 第二位 dev task → 跳过队首，派 dev task', async () => {
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    calculateSlotBudget.mockResolvedValue(makeSlotBudget({ codexAvailable: false }));

    const codexTask = makeCodexTask('codex-hol-1', 'P1');
    const claudeTask = makeClaudeTask('claude-hol-1', 'P1');

    // 第一次返回 codex task，第二次（含 skipIds）返回 dev task
    mockSelectNextDispatchableTask
      .mockResolvedValueOnce(codexTask)
      .mockResolvedValueOnce(claudeTask);

    setupQueryMocks('claude-hol-1');

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('claude-hol-1');

    // 验证 selectNextDispatchableTask 调用了两次
    expect(mockSelectNextDispatchableTask).toHaveBeenCalledTimes(2);
    // 第二次调用时 skipIds 含 codex-hol-1
    const secondCallArgs = mockSelectNextDispatchableTask.mock.calls[1];
    expect(secondCallArgs[1]).toContain('codex-hol-1');
  });

  it('C2: 队首 P0 codex task + codex pool 满 → 全停，不绕过 P0', async () => {
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    calculateSlotBudget.mockResolvedValue(makeSlotBudget({ codexAvailable: false }));

    const p0CodexTask = makeCodexTask('codex-p0-1', 'P0');

    mockSelectNextDispatchableTask.mockResolvedValue(p0CodexTask);

    // Claim succeeds so we reach step 3d codex pool check
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE tasks.*pipeline_terminal_failure/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'codex-p0-1' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    // P0 不绕过：返回 codex_pool_full（不继续找下一个）
    expect(result.reason).toBe('codex_pool_full');
  });

  it('C3: 全部候选是 P1 codex tasks + codex 不可用 → skip cap 触发, reason=hol_skip_cap_exceeded', async () => {
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    calculateSlotBudget.mockResolvedValue(makeSlotBudget({ codexAvailable: false }));

    // 每次都返回新的 codex task（12 个 > cap=10）
    let callCount = 0;
    mockSelectNextDispatchableTask.mockImplementation(async () => {
      callCount++;
      if (callCount <= 12) {
        return makeCodexTask(`codex-cap-${callCount}`, 'P1');
      }
      return null;
    });

    // Each codex task claim succeeds so we reach step 3d HOL check
    mockQuery.mockImplementation((sql) => {
      if (/UPDATE tasks.*pipeline_terminal_failure/.test(sql)) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (/UPDATE tasks SET claimed_by/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'any-codex-task' }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('hol_skip_cap_exceeded');
  });
});
