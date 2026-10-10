/**
 * worker-pool-device-lock.test.js — G5 横切件（task 104ab89f）：worker 池旁路派发接线设备锁。
 *
 * 原 ①/①b/①c/①d/②/②b/③（CAS 预占后抢设备锁、locked/unknown_device 回滚、TTL 透传、无 serial 不调用）：
 * 已随 Claude 通道退役删除（任务 76a160b3）——worker 池不再预占、不再发射，设备锁接线随之消失。
 * dispatcher 主路径的设备锁语义仍由 dispatcher 侧测试覆盖。
 * 现行为：带 device_serial 的任务也不会触发 acquireDeviceLock，也不会释放任何锁。
 */
import { describe, it, expect, vi } from 'vitest';

const mockAcquireDeviceLock = vi.fn();
const mockReleaseDeviceLocksHeldBy = vi.fn().mockResolvedValue(0);
vi.mock('../device-lock-helpers.js', () => ({
  acquireDeviceLock: (...args) => mockAcquireDeviceLock(...args),
  releaseDeviceLocksHeldBy: (...args) => mockReleaseDeviceLocksHeldBy(...args),
  sweepStaleDeviceLocks: vi.fn().mockResolvedValue(0),
}));

import { runWorkerPoolDispatch } from '../worker-pool-dispatch.js';

describe('runWorkerPoolDispatch — 设备锁（Claude 通道已退役）', () => {
  it('带 device_serial 的 parallel_worker 任务：不抢锁、不放锁、不预占，返回 skipped=claude_channel_retired', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ id: 'aaaaaaaa-1111-0000-0000-000000000001', payload: { parallel_worker: true, device_serial: 'ANGYVB4311010223' } }],
        rowCount: 1,
      })),
    };
    const r = await runWorkerPoolDispatch(pool, { execFn: vi.fn() });
    expect(r).toEqual({ skipped: 'claude_channel_retired', dispatched: 0 });
    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
    expect(mockReleaseDeviceLocksHeldBy).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
