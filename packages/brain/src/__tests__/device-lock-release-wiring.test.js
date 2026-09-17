/**
 * device-lock-release-wiring.test.js — G5 横切件（task 104ab89f）：设备锁释放接线。
 *
 * 语义（设计规格 2026-09-16-device-locks-phones-design.md 组件4，计划 Task 6）：
 * - recovery-loop 周期 pass 必须调用 sweepStaleDeviceLocks（对账式释放=正确性主保证，
 *   覆盖 executor 终态直写 / psql 直设 / task 被删等一切回写旁路）
 * - sweeper 抛错不中断其余恢复步骤（各条目独立 try/catch 形状）
 * - task-updater updateTaskStatus 到达非活跃态（completed/failed 等）后即时释放
 *   releaseDeviceLocksHeldBy（低延迟优化）；in_progress / queued 不释放
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) }
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
  publishTaskProgress: vi.fn(),
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

const mockSweepStaleDeviceLocks = vi.fn();
const mockReleaseDeviceLocksHeldBy = vi.fn();
vi.mock('../device-lock-helpers.js', () => ({
  acquireDeviceLock: vi.fn(),
  releaseDeviceLocksHeldBy: (...args) => mockReleaseDeviceLocksHeldBy(...args),
  sweepStaleDeviceLocks: (...args) => mockSweepStaleDeviceLocks(...args),
}));

const TASK_ID = 'aaaaaaaa-1111-0000-0000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockSweepStaleDeviceLocks.mockReset();
  mockSweepStaleDeviceLocks.mockResolvedValue(0);
  mockReleaseDeviceLocksHeldBy.mockReset();
  mockReleaseDeviceLocksHeldBy.mockResolvedValue(0);
});

/** 全量注入 opts：recovery pass 其余条目全 mock，隔离只测设备锁接线 */
function makeRecoveryOpts(overrides = {}) {
  return {
    pool: { query: mockQuery },
    cleanupStaleClaims: vi.fn().mockResolvedValue({ cleaned: 0 }),
    checkStuckPipelines: vi.fn().mockResolvedValue({ canceled: [] }),
    fetchInProgress: vi.fn().mockResolvedValue([]),
    autoFailTimedOutTasks: vi.fn().mockResolvedValue([]),
    probeTaskLiveness: vi.fn().mockResolvedValue([]),
    unblockExpiredTasks: vi.fn().mockResolvedValue([]),
    sweepStaleDeviceLocks: mockSweepStaleDeviceLocks,
    ...overrides,
  };
}

describe('recovery-loop — 设备锁对账 sweeper 接线', () => {
  it('runRecoveryOnce 调用 sweepStaleDeviceLocks（opts 注入形状）', async () => {
    const { runRecoveryOnce } = await import('../recovery-loop.js');
    const opts = makeRecoveryOpts();

    await runRecoveryOnce(opts);

    expect(mockSweepStaleDeviceLocks).toHaveBeenCalledTimes(1);
  });

  it('sweepStaleDeviceLocks 抛错不中断其余恢复步骤（non-fatal）', async () => {
    mockSweepStaleDeviceLocks.mockRejectedValue(new Error('db down'));
    const { runRecoveryOnce } = await import('../recovery-loop.js');
    const opts = makeRecoveryOpts();

    const result = await runRecoveryOnce(opts);

    // 不 throw，且其余条目照常执行
    expect(result).toBeTruthy();
    expect(opts.cleanupStaleClaims).toHaveBeenCalled();
    expect(opts.unblockExpiredTasks).toHaveBeenCalled();
    expect(opts.probeTaskLiveness).toHaveBeenCalled();
  });
});

describe('task-updater — 终态即时释放设备锁', () => {
  function mockUpdateReturning(status) {
    mockQuery.mockResolvedValue({
      rows: [{ id: TASK_ID, status, title: 't', payload: {} }],
      rowCount: 1,
    });
  }

  it("updateTaskStatus(id,'completed') → releaseDeviceLocksHeldBy 被调用", async () => {
    mockUpdateReturning('completed');
    const { updateTaskStatus } = await import('../task-updater.js');

    const r = await updateTaskStatus(TASK_ID, 'completed');

    expect(r.success).toBe(true);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(TASK_ID);
  });

  it("updateTaskStatus(id,'failed') → releaseDeviceLocksHeldBy 被调用", async () => {
    mockUpdateReturning('failed');
    const { updateTaskStatus } = await import('../task-updater.js');

    const r = await updateTaskStatus(TASK_ID, 'failed');

    expect(r.success).toBe(true);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(TASK_ID);
  });

  it("updateTaskStatus(id,'in_progress') 与 'queued' 不释放（活跃态保留锁）", async () => {
    const { updateTaskStatus } = await import('../task-updater.js');

    mockUpdateReturning('in_progress');
    await updateTaskStatus(TASK_ID, 'in_progress');
    expect(mockReleaseDeviceLocksHeldBy).not.toHaveBeenCalled();

    mockUpdateReturning('queued');
    await updateTaskStatus(TASK_ID, 'queued');
    expect(mockReleaseDeviceLocksHeldBy).not.toHaveBeenCalled();
  });

  it('释放抛错不影响 updateTaskStatus 成功返回（non-fatal）', async () => {
    mockUpdateReturning('completed');
    mockReleaseDeviceLocksHeldBy.mockRejectedValue(new Error('db down'));
    const { updateTaskStatus } = await import('../task-updater.js');

    const r = await updateTaskStatus(TASK_ID, 'completed');

    expect(r.success).toBe(true);
  });
});
