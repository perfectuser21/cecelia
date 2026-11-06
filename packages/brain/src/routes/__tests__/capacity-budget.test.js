import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [{ completed_prs: '0', avg_duration_min: '0', earliest: null, latest: null }] }),
  },
}));

vi.mock('../../fleet-resource-cache.js', () => ({
  getTotalEffectiveSlots: vi.fn().mockReturnValue(0),
  getFleetStatus: vi.fn().mockReturnValue([]),
}));

vi.mock('../../capacity.js', () => ({
  getMaxStreams: vi.fn().mockReturnValue(8),
}));

describe('capacity-budget route', () => {
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../capacity-budget.js');
    router = mod.default;
  });

  it('returns machine preflight data without retired PR throughput forecasts', async () => {
    const { getFleetStatus } = await import('../../fleet-resource-cache.js');
    getFleetStatus.mockReturnValueOnce([{ id: 'mac', online: true, effectiveSlots: 2, physicalCapacity: 4, pressure: 0.5 }]);
    const handler = router.stack.find((layer) => layer.route?.path === '/capacity-budget').route.stack[0].handle;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handler({}, res);
    const result = res.json.mock.calls[0][0];
    expect(result.fleet).toEqual([{ id: 'mac', online: true, effective_slots: 2, physical_capacity: 4, pressure: 0.5 }]);
    expect(result).not.toHaveProperty('daily_capacity');
    expect(result).not.toHaveProperty('layer_budgets');
    expect(result).not.toHaveProperty('pr_per_slot_per_day');
  });

  it('should export a router with GET /capacity-budget', () => {
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    const getRoute = router.stack.find(
      (layer) => layer.route?.path === '/capacity-budget' && layer.route?.methods?.get
    );
    expect(getRoute).toBeDefined();
  });

  it('retains area slots, machine vitals and PR threshold without querying history', async () => {
    const { default: pool } = await import('../../db.js');
    const handler = router.stack.find((layer) => layer.route?.path === '/capacity-budget').route.stack[0].handle;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await handler({}, res);
    const result = res.json.mock.calls[0][0];
    expect(result.areas.cecelia).toEqual({ weight: 0.5, slots: 4 });
    expect(result.pr_loc_threshold).toMatchObject({ soft: 200, hard: 400 });
    expect(result.machine_vitals).toHaveProperty('stale');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
