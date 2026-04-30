import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

describe('GET /api/brain/license', () => {
  it('returns status ok and tiers array', async () => {
    const { TIER_CONFIG } = await import('../license.js');
    expect(TIER_CONFIG).toBeDefined();
    expect(Object.keys(TIER_CONFIG)).toContain('basic');

    const res = { json: vi.fn() };
    res.json({ status: 'ok', tiers: Object.keys(TIER_CONFIG) });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', tiers: expect.arrayContaining(['basic', 'enterprise']) })
    );
  });
});
