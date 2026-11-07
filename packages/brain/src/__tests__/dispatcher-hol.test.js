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

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()), execSync: vi.fn(() => ''), execFileSync: vi.fn(() => ''),
}));

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
  PHYSICAL_CAPACITY: 12,
  INTERACTIVE_RESERVE: 2,
  getEffectiveMaxSeats: vi.fn(() => 12),
  getBudgetCap: vi.fn(() => ({ physical: 12, effective: 12 })),
  checkServerResources: vi.fn(() => ({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } })),
  getTokenPressure: vi.fn(async () => ({ token_pressure: 0, available_accounts: 3 })),
}));

vi.mock('../token-budget-planner.js', async (importOriginal) => ({ ...(await importOriginal()), shouldDowngrade: vi.fn(() => false) }));
vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: vi.fn(() => []), getRemoteCapacity: vi.fn(() => ({ online: true, effectiveSlots: 2 })),
  getTotalEffectiveSlots: vi.fn(() => 12),
}));
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
// llm-capacity 必须 mock（issue 5167ef48 修复时发现的环境依赖雷）：不 mock 时真实
// getLlmCapacitySnapshot 会读宿主机 ~/.codex-team* auth 文件——本机 codex 可见时
// 引导员 L3 跨厂商把 dev 任务路由到 codex，撞上本测试的 codex 满池 fixture → C1 假红。
// 测试必须与宿主机凭据状态隔离。
vi.mock('../llm-capacity.js', () => ({
  CODEX_ACCOUNTS: [],
  getLlmCapacitySnapshot: vi.fn().mockResolvedValue(null),
  chooseGuidedExecutor: vi.fn(() => null),
  summarizeLlmCapacity: vi.fn(() => null),
}));

vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn().mockResolvedValue({ ok: true }),
  getAccountUsage: vi.fn().mockResolvedValue({ account1: { account_id: 'account1', seven_day_pct: 0 } }),
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

vi.mock('../slot-allocator.js', async (importOriginal) => ({
  ...(await importOriginal()),
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: vi.fn(),
  shouldBypassBackpressure: vi.fn(() => false),
}));

vi.mock('../eviction.js', () => ({
  findEvictionCandidate: vi.fn(), requeueEvictedTask: vi.fn(),
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
  return { id, task_type: 'research', priority, title: `Claude task ${id}`, payload: {}, project_id: null, created_at: '2026-07-16T00:00:00Z' };
}

function setupQueryMocks(dispatchedTaskId, taskType = 'research') {
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
      return Promise.resolve({ rows: [{ id: dispatchedTaskId, task_type: taskType, payload: {}, priority: 'P1', title: 'dispatch task' }] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

describe('dispatcher HOL blocking fix', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    const { checkQuotaGuard } = await import('../quota-guard.js');
    const { getTokenPressure, checkServerResources } = await import('../executor.js');
    const { getRemoteCapacity } = await import('../fleet-resource-cache.js');
    const { getAccountUsage } = await import('../account-usage.js');
    checkQuotaGuard.mockResolvedValue({ allow: true, priorityFilter: null, reason: 'quota_ok', bestPct: 0 });
    getTokenPressure.mockResolvedValue({ token_pressure: 0, available_accounts: 3 });
    checkServerResources.mockReturnValue({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } });
    getRemoteCapacity.mockReturnValue({ online: true, effectiveSlots: 2 });
    getAccountUsage.mockResolvedValue({ account1: { account_id: 'account1', seven_day_pct: 0 } });
  });

  it('旧 Claude 额度满时仍可派发有空位的 Codex 任务', async () => {
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    const { checkQuotaGuard } = await import('../quota-guard.js');
    calculateSlotBudget.mockResolvedValue(makeSlotBudget({ codexAvailable: true }));
    checkQuotaGuard.mockResolvedValueOnce({ allow: false, reason: 'quota_critical', bestPct: 100 });
    mockSelectNextDispatchableTask.mockResolvedValueOnce(makeCodexTask('codex-available', 'P1'));
    setupQueryMocks('codex-available', 'codex_dev');

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('codex-available');
    const { triggerCeceliaRun } = await import('../executor.js');
    expect(triggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'codex-available', task_type: 'codex_dev' }));
  });

  it('真实槽位预算链路：旧 Claude 满额不挡 Codex，机器无槽时仍拒绝', async () => {
    const actual = await vi.importActual('../slot-allocator.js');
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    const { getTokenPressure, checkServerResources, triggerCeceliaRun } = await import('../executor.js');
    const { checkQuotaGuard } = await import('../quota-guard.js');
    const { getRemoteCapacity } = await import('../fleet-resource-cache.js');
    const { getAccountUsage } = await import('../account-usage.js');
    actual._resetSlotBuffer();
    calculateSlotBudget.mockImplementation(actual.calculateSlotBudget);
    getTokenPressure.mockResolvedValue({ token_pressure: 0, available_accounts: 3 });
    getAccountUsage.mockResolvedValue({ account1: { account_id: 'account1', seven_day_pct: 100, seven_day_sonnet_pct: 100 } });
    checkQuotaGuard.mockResolvedValue({ allow: false, reason: 'quota_critical', bestPct: 100 });
    mockSelectNextDispatchableTask.mockImplementation(async (_goalIds, _skip, options) =>
      options?.onlyTaskTypes ? null : makeCodexTask('codex-real-budget', 'P1'));
    setupQueryMocks('codex-real-budget', 'codex_dev');
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(true);
    expect(triggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'codex-real-budget', task_type: 'codex_dev' }));

    actual._resetSlotBuffer();
    checkServerResources.mockReturnValue({ effectiveSlots: 0, metrics: { max_pressure: 1 } });
    getRemoteCapacity.mockReturnValue(null);
    const stopped = await actual.calculateSlotBudget();
    expect(stopped.dispatchAllowed).toBe(false);
  });

  it('C1: 队首 codex task (P1) + codex pool 满 + 第二位 Claude task → 跳过队首并派发', async () => {
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
    // 已退役的 Claude 满额不得抢先阻塞 Codex；Codex 池自身的上限仍生效。
    const { checkQuotaGuard } = await import('../quota-guard.js');
    checkQuotaGuard.mockResolvedValueOnce({ allow: false, reason: 'quota_critical', bestPct: 100 });

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


describe('机群硬资源关闭不驱逐既有任务', () => {
  it('高优排队且所有机器不可用时既不kill也不回队', async () => {
    vi.clearAllMocks();
    const { calculateSlotBudget } = await import('../slot-allocator.js');
    const { findEvictionCandidate, requeueEvictedTask } = await import('../eviction.js');
    const { killProcessTwoStage, triggerCeceliaRun } = await import('../executor.js');
    calculateSlotBudget.mockResolvedValue({
      ...makeSlotBudget({ codexAvailable: false }),
      dispatchAllowed: false, resourceAdmissionBlocked: true,
      resources: { effectiveSlots: 0 }, taskPool: { budget: 0, available: 0 },
    });
    mockQuery.mockImplementation(async () => ({ rows: [{ priority: 'P0' }] }));
    findEvictionCandidate.mockResolvedValue({ taskId: 'running-low', priority: 'P2', pgid: 123, score: 1 });
    killProcessTwoStage.mockResolvedValue({ killed: false });
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(killProcessTwoStage).not.toHaveBeenCalled();
    expect(findEvictionCandidate).not.toHaveBeenCalled();
    expect(requeueEvictedTask).not.toHaveBeenCalled();
    expect(triggerCeceliaRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dispatched: false, reason: 'resource_unavailable', actions: [] });
  });
});
