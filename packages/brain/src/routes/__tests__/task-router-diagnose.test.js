import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

describe('GET /api/brain/task-router/diagnose', () => {
  it('returns status ok and usage hint', async () => {
    const router = (await import('../task-router-diagnose.js')).default;

    // 找到 GET /diagnose handler（无参数版本）
    const layer = router.stack.find(l => l.route?.path === '/diagnose' && l.route?.methods?.get);
    expect(layer).toBeDefined();

    const req = {};
    const res = { json: vi.fn() };
    await layer.route.stack[0].handle(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', usage: expect.stringContaining(':kr_id') })
    );
  });
});
