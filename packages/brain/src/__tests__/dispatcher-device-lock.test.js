/**
 * dispatcher-device-lock.test.js — G5 横切件（task 104ab89f）：dispatcher 派发接线设备锁。
 *
 * 语义（设计规格 2026-09-16-device-locks-phones-design.md 组件3）：
 * - payload.device_serial 存在 → 原子 claim 成功之后、triggerCeceliaRun 之前抢设备锁
 * - {result:'locked'}   → 释放 claim（复用 HOL skip 形状），不派发
 * - {result:'unknown_device'} → 任务 terminal failed + error_message 含 serial +
 *   payload.failure_class='unknown_device'（防静默饿死 queued，drain 泄漏病史同型）
 * - {result:'acquired'} → 正常走 triggerCeceliaRun
 * - 无 device_serial → acquireDeviceLock 从不被调用（零开销路径）
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
const SERIAL = 'ANGYVB4311010223';
const ANCHOR = { journey_id: 'j-test', gp_id: 'gp-test', step_id: 'step-test' };
const PHONE_TASK = {
  id: 'aaaaaaaa-1111-0000-0000-000000000001',
  task_type: 'android_publish',
  project_id: null,
  priority: 'P1',
  title: '手机发布任务（带 device_serial）',
  payload: { device_serial: SERIAL, anchor: ANCHOR },
  created_at: '2026-09-16T00:00:00Z',
};
const PLAIN_TASK = {
  id: 'bbbbbbbb-2222-0000-0000-000000000002',
  task_type: 'android_publish',
  project_id: null,
  priority: 'P1',
  title: '普通任务（无 device_serial）',
  payload: { anchor: ANCHOR },
  created_at: '2026-09-16T00:00:00Z',
};

describe('dispatchNextTask — 设备锁接线（G5 横切件 task 104ab89f）', () => {
  let releasedClaimIds;
  let allQueries;
  let candidates;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockSelectNextDispatchableTask.mockReset();
    mockCheckAvailable.mockReset();
    mockTriggerCeceliaRun.mockReset();
    mockAcquireDeviceLock.mockReset();
    mockReleaseDeviceLocksHeldBy.mockReset();
    mockReleaseDeviceLocksHeldBy.mockResolvedValue(0);

    releasedClaimIds = [];
    allQueries = [];
    candidates = [];

    mockSelectNextDispatchableTask.mockImplementation(async (_goalIds, skipIds = []) => {
      return candidates.find((c) => !skipIds.includes(c.id)) ?? null;
    });

    mockQuery.mockImplementation((sql, params) => {
      allQueries.push({ sql, params });
      if (/UPDATE tasks SET claimed_by\s*=\s*\$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: params[1] }] });
      }
      if (/UPDATE tasks SET claimed_by\s*=\s*NULL/.test(sql)) {
        releasedClaimIds.push(params[0]);
        return Promise.resolve({ rows: [] });
      }
      if (/SELECT count\(\*\)::int AS n FROM tasks/.test(sql)) {
        return Promise.resolve({ rows: [{ n: 0 }] });
      }
      if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
        const row = candidates.find((c) => c.id === params[0]);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    mockCheckAvailable.mockResolvedValue({ available: true });
    mockTriggerCeceliaRun.mockResolvedValue({ success: true, pid: 4321, runId: 'run-devlock-1' });
  });

  it('分支1 locked：设备被占 → 释放 claim、不派发（HOL skip 形状）', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id' },
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(PHONE_TASK.id, SERIAL, undefined);
    // claim 必须被释放（UPDATE tasks SET claimed_by = NULL）
    expect(releasedClaimIds).toContain(PHONE_TASK.id);
    // 绝不能派发
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('分支2 unknown_device：serial 未注册 → 任务 terminal failed + error_message 含 serial + failure_class', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({ result: 'unknown_device' });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // 必须有一条把任务打成 failed 的 UPDATE，error_message 参数含 serial
    const failUpdate = allQueries.find(({ sql, params }) =>
      /UPDATE tasks/.test(sql)
      && /status\s*=\s*'failed'/.test(sql)
      && Array.isArray(params) && params[0] === PHONE_TASK.id
      && params.some((p) => typeof p === 'string' && p.includes(SERIAL))
    );
    expect(failUpdate).toBeTruthy();
    // payload 打上 failure_class='unknown_device'（终态经 lib/task-terminal.js 收口：payload 合并走 jsonb 参数）
    expect(failUpdate.sql).toMatch(/payload = COALESCE\(payload, '\{\}'::jsonb\) \|\| \$\d+::jsonb/);
    expect(failUpdate.params.some((p) => typeof p === 'string' && p.includes('"failure_class":"unknown_device"'))).toBe(true);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('分支3 acquired：抢锁成功 → 正常走 triggerCeceliaRun', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: PHONE_TASK.id },
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(PHONE_TASK.id, SERIAL, undefined);
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(PHONE_TASK.id);
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: PHONE_TASK.id })
    );
  });

  it('分支4 无 device_serial：acquireDeviceLock 从不被调用', async () => {
    candidates = [PLAIN_TASK];

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(PLAIN_TASK.id);
  });

  it('分支1 补充：device_ttl_minutes 透传给 acquireDeviceLock', async () => {
    const ttlTask = { ...PHONE_TASK, payload: { device_serial: SERIAL, device_ttl_minutes: 90, anchor: ANCHOR } };
    candidates = [ttlTask];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: ttlTask.id },
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask([]);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(ttlTask.id, SERIAL, 90);
  });

  it('revert 释放：locked 跳过后队列耗尽 → 结果非 dispatched（锁本身没抢到，无泄漏面）', async () => {
    candidates = [PHONE_TASK, PLAIN_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id' },
    });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    // 被占的手机任务跳过后，下一个无 serial 候选照常派发（不阻塞队列）
    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe(PLAIN_TASK.id);
    expect(releasedClaimIds).toContain(PHONE_TASK.id);
  });

  it('分支1 fail-closed：acquire 抛错 → 按被占处理，释放 claim 且不派发', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockRejectedValue(new Error('db down'));

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(PHONE_TASK.id, SERIAL, undefined);
    expect(releasedClaimIds).toContain(PHONE_TASK.id);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
  });

  it('revert 释放：acquired 后 executor 不可用（no_executor）→ releaseDeviceLocksHeldBy 被调用', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: PHONE_TASK.id },
    });
    mockCheckAvailable.mockResolvedValue({ available: false, error: 'bridge down' });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(releasedClaimIds).toContain(PHONE_TASK.id);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(PHONE_TASK.id);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });

  it('revert 释放：acquired 后 circuit breaker 拦截 → releaseDeviceLocksHeldBy 被调用', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: PHONE_TASK.id },
    });
    const cb = await import('../circuit-breaker.js');
    cb.isAllowed.mockReturnValue(false);
    try {
      const { dispatchNextTask } = await import('../dispatcher.js');
      const result = await dispatchNextTask([]);

      expect(result.dispatched).toBe(false);
      expect(result.reason).toBe('circuit_breaker_open');
      expect(releasedClaimIds).toContain(PHONE_TASK.id);
      expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(PHONE_TASK.id);
      expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    } finally {
      cb.isAllowed.mockReturnValue(true); // clearAllMocks 不还原实现，必须手动复原
    }
  });

  it('revert 释放：acquired 后 executor 派发失败 → releaseDeviceLocksHeldBy 被调用（锁不泄漏到 TTL）', async () => {
    candidates = [PHONE_TASK];
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: PHONE_TASK.id },
    });
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, reason: 'spawn_failed', error: 'boom' });

    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask([]);

    expect(result.dispatched).toBe(false);
    expect(releasedClaimIds).toContain(PHONE_TASK.id);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(PHONE_TASK.id);
  });
});
