/**
 * 手动派发端点 × 资源健康（任务 5bf2512a）：POST /dispatch-now 与 POST /tasks/:id/dispatch 共用
 * checkDeviceLockForManualDispatch，健康闸挂在它最前面 → 两个入口一次站住。
 * - 引用资源 offline/restricted → 409 resource_unhealthy（带原因），不抢设备锁
 * - payload.resource_health_override=true → 人工确认过，放行
 * - 健康闸出错 → fail-safe 放行，继续原设备锁逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));
const mockAcquireDeviceLock = vi.hoisted(() => vi.fn());
vi.mock('../../device-lock-helpers.js', () => ({
  acquireDeviceLock: (...args) => mockAcquireDeviceLock(...args),
  releaseDeviceLocksHeldBy: vi.fn().mockResolvedValue(0),
}));

const { checkDeviceLockForManualDispatch } = await import('../manual-dispatch-device-gate.js');
const { _resetGateEventMemo } = await import('../resource-health-gate.js');

const restricted = [{ resource_type: 'phone', resource_key: 'S1', status: 'offline', reason: 'adb 掉线', observed_at: new Date().toISOString() }];

beforeEach(() => {
  mockQuery.mockReset();
  mockAcquireDeviceLock.mockReset();
  mockAcquireDeviceLock.mockResolvedValue({ result: 'acquired' });
  _resetGateEventMemo();
});

describe('手动派发资源健康闸', () => {
  it('手机掉线 → 409 resource_unhealthy，不抢设备锁', async () => {
    mockQuery.mockImplementation(async (sql) => (/FROM resource_health/.test(sql) ? { rows: restricted } : { rows: [] }));
    const r = await checkDeviceLockForManualDispatch({ id: 't1', payload: { device_serial: 'S1' } }, 'test');
    expect(r.pass).toBe(false);
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ success: false, error: 'resource_unhealthy' });
    expect(r.body.reasons[0]).toMatchObject({ key: 'S1', status: 'offline' });
    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
  });

  it('resource_health_override=true → 放行，照常抢锁', async () => {
    mockQuery.mockImplementation(async (sql) => (/FROM resource_health/.test(sql) ? { rows: restricted } : { rows: [] }));
    const r = await checkDeviceLockForManualDispatch({ id: 't2', payload: { device_serial: 'S1', resource_health_override: true } }, 'test');
    expect(r.pass).toBe(true);
    expect(mockAcquireDeviceLock).toHaveBeenCalled();
  });

  it('健康闸出错 → fail-safe 放行到设备锁逻辑', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const r = await checkDeviceLockForManualDispatch({ id: 't3', payload: { device_serial: 'S1' } }, 'test');
    expect(r).toEqual({ pass: true, acquired: true });
  });
});
