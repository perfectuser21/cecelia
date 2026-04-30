import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

describe('GET /api/brain/license', () => {
  it('returns status ok and tiers array', async () => {
    const router = (await import('../license.js')).default;

    // 找到 GET / handler
    const layer = router.stack.find(l => l.route?.path === '/' && l.route?.methods?.get);
    expect(layer).toBeDefined();

    const req = {};
    const res = { json: vi.fn() };
    await layer.route.stack[0].handle(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', tiers: expect.arrayContaining(['basic', 'enterprise']) })
    );
  });
});
