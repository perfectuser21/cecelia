import { describe, expect, it, vi } from 'vitest';
import { collectReplacementSnapshot, reserveExpiredAttemptReplacement } from './attempt-resource-replacement.js';

describe('恢复资源预约', () => {
  it('从当前生产探针取得基础槽并给快照有界有效期', async () => {
    const capacity = { ok: true, physical_base_slots: 7, effective_base_slots: 6 };
    const probes = { getMachineCapacity: vi.fn(async () => capacity) };
    const snapshot = await collectReplacementSnapshot({ machineId: 'us-mac-m4', role: 'generator', bundle: { inputs: {} } }, { probes, now: () => 1000 });
    expect(snapshot).toEqual({ verified: true, machine: 'us-mac-m4', capacity, created_at: 1000, expires_at: 31000 });
    expect(probes.getMachineCapacity).toHaveBeenCalledWith({ machine: 'us-mac-m4', task_bundle: { role: 'generator', inputs: {} } });
  });
  it('不可事务的连接拒绝恢复', async () => {
    await expect(reserveExpiredAttemptReplacement({ pool: { query: vi.fn() } })).rejects.toThrow('replacement_requires_transactional_pool');
  });
});
