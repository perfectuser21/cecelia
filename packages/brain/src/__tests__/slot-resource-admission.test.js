import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('child_process', () => ({ execSync: vi.fn(() => '') }));
vi.mock('../executor.js', () => ({
  MAX_SEATS: 12, PHYSICAL_CAPACITY: 12,
  getEffectiveMaxSeats: () => 12,
  getBudgetCap: () => ({ physical: 12, effective: 12 }),
  checkServerResources: vi.fn(() => ({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } })),
  getActiveProcessCount: () => 0,
  getTokenPressure: async () => ({ token_pressure: 0, available_accounts: 3 }),
}));
vi.mock('../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [{ count: '0' }] })) } }));
vi.mock('../token-budget-planner.js', () => ({ calculateBudgetState: async () => ({ pool_c_scale: 1 }) }));
vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: () => [], getRemoteCapacity: vi.fn(() => null), getTotalEffectiveSlots: vi.fn(() => 12),
}));
import { execSync } from 'child_process';
import pool from '../db.js';
import { checkServerResources } from '../executor.js';
import { getRemoteCapacity, getTotalEffectiveSlots } from '../fleet-resource-cache.js';
import { calculateSlotBudget, getCodexMaxConcurrent, _resetSlotBuffer } from '../slot-allocator.js';


describe('资源硬零必须即时阻断派单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSlotBuffer();
    execSync.mockReturnValue('');
    pool.query.mockResolvedValue({ rows: [{ count: '0' }] });
    checkServerResources.mockReturnValue({ effectiveSlots: 12, metrics: { max_pressure: 0.1 } });
    getRemoteCapacity.mockReturnValue(null);
  });

  it('两个Codex节点未知时没有默认三个槽', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.codex).toMatchObject({ max: 0, available: false });
  });

  it('两机离线时停止Codex新增派单，单机恢复只提供其真实容量', () => {
    getRemoteCapacity.mockReturnValue({ online: false, effectiveSlots: 4 });
    expect(getCodexMaxConcurrent()).toBe(0);
    getRemoteCapacity.mockImplementation(id => id === 'xian-mac-m4'
      ? { online: true, effectiveSlots: 2 } : null);
    expect(getCodexMaxConcurrent()).toBe(2);
  });

  it('远端容量骤降零立即停派，恢复仍逐步增长', async () => {
    vi.stubEnv('CECELIA_LOCAL_EXECUTION_ENABLED', 'false');
    try {
      getTotalEffectiveSlots.mockReturnValue(12);
      expect((await calculateSlotBudget()).taskPool.available).toBe(12);
      getTotalEffectiveSlots.mockReturnValue(0);
      const stopped = await calculateSlotBudget();
      expect(stopped.taskPool.available).toBe(0);
      expect(stopped.dispatchAllowed).toBe(false);
      expect(stopped.resourceAdmissionBlocked).toBe(true);
      getTotalEffectiveSlots.mockReturnValue(12);
      expect((await calculateSlotBudget()).taskPool.available).toBe(1);
    } finally { vi.unstubAllEnvs(); }
  });
});
