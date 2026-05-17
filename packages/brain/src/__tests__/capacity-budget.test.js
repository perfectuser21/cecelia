import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [{ completed_prs: '0', avg_duration_min: '0', earliest: null, latest: null }] }),
  },
}));

vi.mock('../fleet-resource-cache.js', () => ({
  getTotalEffectiveSlots: vi.fn().mockReturnValue(0),
  getFleetStatus: vi.fn().mockReturnValue([]),
}));

vi.mock('../capacity.js', () => ({
  getMaxStreams: vi.fn().mockReturnValue(8),
}));

describe('capacity-budget route', () => {
  let router;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../routes/capacity-budget.js');
    router = mod.default;
  });

  it('should export a router with GET /capacity-budget', () => {
    expect(router).toBeDefined();
    expect(router.stack).toBeDefined();
    const getRoute = router.stack.find(
      (layer) => layer.route?.path === '/capacity-budget' && layer.route?.methods?.get
    );
    expect(getRoute).toBeDefined();
  });

  it('should return theoretical confidence when no historical data', async () => {
    const { default: pool } = await import('../db.js');
    pool.query.mockResolvedValueOnce({
      rows: [{ completed_prs: '0', avg_duration_min: '0', earliest: null, latest: null }],
    });

    // Find handler and call it
    const getRoute = router.stack.find(
      (layer) => layer.route?.path === '/capacity-budget'
    );
    const handler = getRoute.route.stack[0].handle;

    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    await handler({}, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const result = res.json.mock.calls[0][0];
    expect(result.pr_per_slot_per_day).toBe(25);
    expect(result.confidence).toBe('theoretical');
    expect(result.sample_size).toBe(0);
    expect(result.areas).toBeDefined();
    expect(result.areas.cecelia).toBeDefined();
    expect(result.areas.zenithjoy).toBeDefined();
    expect(result.layer_budgets).toBeDefined();
    expect(result.layer_budgets.task.pr_count).toBe(1);
    // Phase 8.3: pr_loc_threshold 必须存在
    expect(result.pr_loc_threshold).toBeDefined();
    expect(result.pr_loc_threshold.soft).toBe(200);
    expect(result.pr_loc_threshold.hard).toBe(400);
    expect(result.pr_loc_threshold.source).toMatch(/smartbear|microsoft/i);
  });

  it('should use empirical data when sample_size >= 10', async () => {
    const { default: pool } = await import('../db.js');
    pool.query.mockResolvedValueOnce({
      rows: [{ completed_prs: '80', avg_duration_min: '35', earliest: new Date(), latest: new Date() }],
    });

    const { getMaxStreams } = await import('../capacity.js');
    getMaxStreams.mockReturnValue(8);

    const getRoute = router.stack.find(
      (layer) => layer.route?.path === '/capacity-budget'
    );
    const handler = getRoute.route.stack[0].handle;

    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };

    await handler({}, res);

    const result = res.json.mock.calls[0][0];
    // 80 samples >= 50 → medium confidence
    expect(result.confidence).toBe('medium');
    expect(result.pr_per_slot_per_day).toBeGreaterThan(0);
    expect(result.pr_per_slot_per_day).not.toBe(25); // Should NOT be theoretical
    expect(result.avg_pr_duration_min).toBe(35);
  });
});
