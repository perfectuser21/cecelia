import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('area-scheduler', () => {
  it('should export selectAreaForDispatch and getAreaSchedulerStatus', async () => {
    const mod = await import('../area-scheduler.js');
    expect(typeof mod.selectAreaForDispatch).toBe('function');
    expect(typeof mod.getAreaSchedulerStatus).toBe('function');
  });

  it('should export DEFAULT_AREA_SLOTS with cecelia/zenithjoy/investment', async () => {
    const { DEFAULT_AREA_SLOTS } = await import('../area-scheduler.js');
    expect(DEFAULT_AREA_SLOTS).toHaveProperty('cecelia');
    expect(DEFAULT_AREA_SLOTS).toHaveProperty('zenithjoy');
    expect(DEFAULT_AREA_SLOTS).toHaveProperty('investment');
    expect(DEFAULT_AREA_SLOTS.cecelia.min).toBe(3);
  });

  it('should return no_eligible_area when no queued tasks', async () => {
    const pool = (await import('../db.js')).default;
    // getAreaConfig: no config in DB
    pool.query.mockResolvedValueOnce({ rows: [] });
    // getAreaTaskCounts: no tasks
    pool.query.mockResolvedValueOnce({ rows: [] });

    const { selectAreaForDispatch } = await import('../area-scheduler.js');
    const result = await selectAreaForDispatch(5);
    expect(result.area).toBeNull();
    expect(result.reason).toBe('no_eligible_area');
  });
});
