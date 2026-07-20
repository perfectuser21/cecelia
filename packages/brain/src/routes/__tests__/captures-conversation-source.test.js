import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('captures route — 三工具 source 值 + session_summary nature', () => {
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

  it.each(['conversation-claude', 'conversation-codex', 'conversation-grok'])('source=%s 被接受', async (source) => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'captured', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });

  it('旧的 source=conversation（未分工具）不再被接受', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'conversation' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('nature=session_summary 被接受', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'clarified', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '摘要内容', source: 'conversation-claude', nature: 'session_summary' } };
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
