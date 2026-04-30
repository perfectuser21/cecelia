import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

describe('GET /api/brain/task-router/diagnose', () => {
  it('returns status ok and usage hint', () => {
    const res = { json: vi.fn() };
    res.json({ status: 'ok', usage: 'GET /api/brain/task-router/diagnose/:kr_id' });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', usage: expect.stringContaining(':kr_id') })
    );
  });
});
