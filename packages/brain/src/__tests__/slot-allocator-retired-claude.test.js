import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const retired = vi.hoisted(() => ({ budget: vi.fn(), pressure: vi.fn() }));
vi.mock('../executor.js', () => ({
  MAX_SEATS: 8,
  PHYSICAL_CAPACITY: 8,
  getEffectiveMaxSeats: () => 8,
  getBudgetCap: () => ({ budget: null, physical: 8, effective: 8 }),
  checkServerResources: () => ({ effectiveSlots: 8, metrics: { max_pressure: 0.1 } }),
  getActiveProcessCount: () => 0,
  getTokenPressure: retired.pressure,
}));
vi.mock('../token-budget-planner.js', () => ({ calculateBudgetState: retired.budget }));
vi.mock('../db.js', () => ({ default: { query: vi.fn(async () => ({ rows: [{ count: '0' }] })) } }));
vi.mock('../platform-utils.js', () => ({
  listProcessesWithElapsed: () => [],
  listProcessesWithPpid: () => [],
  evaluateMemoryHealth: () => ({ action: 'none' }),
  getBrainRssMB: () => 100,
}));
vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: () => [],
  getRemoteCapacity: () => ({ online: true, effectiveSlots: 2 }),
  getTotalEffectiveSlots: () => 4,
}));
vi.mock('os', async (original) => ({ default: { ...(await original()), freemem: () => 8 * 1024 ** 3 } }));

import { _resetSlotBuffer, calculateSlotBudget, getSlotStatus } from '../slot-allocator.js';

describe('机器容量不再读取退役 Claude 展示指标', () => {
  beforeEach(() => {
    vi.stubEnv('CECELIA_LOCAL_EXECUTION_ENABLED', 'true');
    _resetSlotBuffer();
    retired.budget.mockReset().mockRejectedValue(new Error('retired_budget_must_not_run'));
    retired.pressure.mockReset().mockRejectedValue(new Error('retired_pressure_must_not_run'));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('真实槽位计算保留机器与现役执行器容量，不启动旧预算或用量查询', async () => {
    const budget = await calculateSlotBudget();
    expect(budget.resources.effectiveSlots).toBe(8);
    expect(budget.taskPool.available).toBe(8);
    expect(budget.codex).toEqual({ running: 0, max: 4, available: true });
    expect(budget.dispatchAllowed).toBe(true);
    expect(retired.budget).not.toHaveBeenCalled();
    expect(retired.pressure).not.toHaveBeenCalled();
  });

  it('槽位 API 的退役展示值明确为空，不伪造健康额度', async () => {
    const status = await getSlotStatus();
    expect(status.budget_state).toBeNull();
    expect(status.pressure.token).toBeNull();
    expect(status.dispatch_allowed).toBe(true);
  });
});
