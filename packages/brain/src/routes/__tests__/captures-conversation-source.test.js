import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('captures route — VALID_SOURCES 含 conversation', () => {
  let router, pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../db.js')).default;
    router = (await import('../captures.js')).default;
  });

  function findPostHandler() {
    const layer = router.stack.find((l) => l.route?.path === '/' && l.route.methods.post);
    return layer.route.stack[0].handle;
  }

  function mockRes() {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  it('source=conversation 被接受（不落 400）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'captured', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'conversation' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });

  it('非法 source 仍被 400 拒绝', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'not-a-real-source' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/source must be one of/);
  });
});
