/**
 * dispatcher-resource-health.test.js — 任务 5bf2512a（决策 de6dff5d 第 5 步）：派发前查资源健康。
 * - 引用的资源 offline/restricted → 放 claim、不派发、记 resource_unhealthy，换下一个候选
 * - 健康/没记录 → 照常派发
 * - 健康闸自身出错 → fail-safe 照常派发（绝不让原派发路径失败）
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

const mockCheckAvailable = vi.fn();
const mockTriggerCeceliaRun = vi.fn();
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckAvailable(...args),
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
const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
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

const mockAcquireDeviceLock = vi.fn();
const mockReleaseDeviceLocksHeldBy = vi.fn().mockResolvedValue(0);
vi.mock('../device-lock-helpers.js', () => ({
  acquireDeviceLock: (...args) => mockAcquireDeviceLock(...args),
  releaseDeviceLocksHeldBy: (...args) => mockReleaseDeviceLocksHeldBy(...args),
  sweepStaleDeviceLocks: vi.fn().mockResolvedValue(0),
}));

// ─── 候选任务 fixture（非 coding 类型 → 不进 routing receipt 门；带锚过 S2 锚点闸）──
const ANCHOR = { journey_id: 'j-test', gp_id: 'gp-test', step_id: 'step-test' };
const ACCOUNT_TASK = {
  id: 'dddddddd-1111-0000-0000-000000000001',
  task_type: 'android_publish',
  project_id: null,
  priority: 'P1',
  title: '用某账号发布',
  payload: { account_ref: { platform: 'douyin', account_id: 'a1' }, anchor: ANCHOR },
  created_at: '2026-10-10T00:00:00Z',
};
const PLAIN_TASK = {
  id: 'eeeeeeee-2222-0000-0000-000000000002',
  task_type: 'android_publish',
  project_id: null,
  priority: 'P1',
  title: '普通任务（不引用资源）',
  payload: { anchor: ANCHOR },
  created_at: '2026-10-10T00:00:00Z',
};

describe('dispatchNextTask — 资源健康闸（任务 5bf2512a）', () => {
  let releasedClaimIds;
  let candidates;
  let healthRows;
  let healthError;
  let healthQueries;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockCheckAvailable.mockReset();
    mockTriggerCeceliaRun.mockReset();
    (await import('../lib/resource-health-gate.js'))._resetGateEventMemo();

    releasedClaimIds = [];
    candidates = [];
    healthRows = [];
    healthError = null;
    healthQueries = 0;

    mockSelectNextDispatchableTask.mockImplementation(async (_goalIds, skipIds = []) =>
      candidates.find((c) => !skipIds.includes(c.id)) ?? null);

    mockQuery.mockImplementation((sql, params) => {
      if (/FROM resource_health/.test(sql)) {
        healthQueries += 1;
        if (healthError) return Promise.reject(healthError);
        return Promise.resolve({ rows: healthRows });
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) return Promise.resolve({ rows: [{ id: params[1] }] });
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaimIds.push(params[0]);
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT count\(\*\)::int AS n FROM tasks/.test(sql)) return Promise.resolve({ rows: [{ n: 0 }] });
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        const row = candidates.find((c) => c.id === params[0]);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    mockCheckAvailable.mockResolvedValue({ available: true });
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 4321, runId: 'run-health-1' });
  });

  it('账号被风控 → 放 claim、不派发、记 resource_unhealthy', async () => {
    candidates = [ACCOUNT_TASK];
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '切换要人脸', observed_at: new Date().toISOString() }];
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(false);
    expect(releasedClaimIds).toContain(ACCOUNT_TASK.id);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(mockRecordDispatchResult).toHaveBeenCalledWith(expect.anything(), false, 'resource_unhealthy', undefined, ACCOUNT_TASK.id);
  });

  it('被挡的任务让位后，下一个不引用资源的候选照常派发', async () => {
    candidates = [ACCOUNT_TASK, PLAIN_TASK];
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'offline', reason: '切换列表消失', observed_at: new Date().toISOString() }];
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(PLAIN_TASK.id);
  });

  it('账号健康 → 照常派发', async () => {
    candidates = [ACCOUNT_TASK];
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'healthy', reason: null, observed_at: new Date().toISOString() }];
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(ACCOUNT_TASK.id);
  });

  it('健康闸查库抛错 → fail-safe 照常派发', async () => {
    candidates = [ACCOUNT_TASK];
    healthError = new Error('relation "resource_health" does not exist');
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(healthQueries).toBe(1);
    expect(result.dispatched).toBe(true);
  });

  it('回归：队首 12 张引用同一风控账号的任务不占 HOL 让位名额，后面的普通任务照常派发', async () => {
    const blocked = Array.from({ length: 12 }, (_, i) => ({
      ...ACCOUNT_TASK,
      id: `dddddddd-1111-0000-0000-${String(100 + i).padStart(12, '0')}`,
    }));
    candidates = [...blocked, PLAIN_TASK];
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '切换要人脸', observed_at: new Date().toISOString() }];
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(PLAIN_TASK.id);
    const reasons = mockRecordDispatchResult.mock.calls.map((c) => c[2]);
    expect(reasons).not.toContain('hol_skip_cap_exceeded');
    expect(reasons.filter((r) => r === 'resource_unhealthy')).toHaveLength(12);
  });

  it('健康闸挡单有自己的上限（100），超过才放弃本轮，原因是 resource_skip_cap_exceeded', async () => {
    candidates = Array.from({ length: 105 }, (_, i) => ({
      ...ACCOUNT_TASK,
      id: `dddddddd-1111-0000-0000-${String(1000 + i).padStart(12, '0')}`,
    }));
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'offline', reason: '掉线', observed_at: new Date().toISOString() }];
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('resource_skip_cap_exceeded');
    const reasons = mockRecordDispatchResult.mock.calls.map((c) => c[2]);
    expect(reasons).not.toContain('hol_skip_cap_exceeded');
  });

  it('不引用资源的任务 → 不查健康表', async () => {
    candidates = [PLAIN_TASK];
    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask([]);
    expect(healthQueries).toBe(0);
  });
});
