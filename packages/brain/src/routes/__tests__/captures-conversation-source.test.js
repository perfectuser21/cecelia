import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('captures route — 三工具 source 值 + session_summary nature', () => {
  let router, pool;

  beforeEach(async () => {
    vi.resetAllMocks();
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
    const row = { id: 'x', status: 'captured', dedupe_key: null, created_at: new Date('2026-11-03T00:00:00Z') };
    pool.query.mockResolvedValueOnce({ rows: [row] });
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(row);
    expect(res.body.status).toBe('captured');
    expect(pool.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/INSERT INTO captures[\s\S]*RETURNING id, status, dedupe_key, created_at/),
      ['测试内容', source, null, null, null, null, null, null, null, 'captured'],
    );
  });

  it('旧的 source=conversation（未分工具）不再被接受', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'conversation' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('nature=session_summary 被接受', async () => {
    const row = { id: 'x', status: 'clarified', dedupe_key: null, created_at: new Date('2026-11-03T00:00:00Z') };
    pool.query.mockResolvedValueOnce({ rows: [row] });
    const handler = findPostHandler();
    const req = { body: { content: '摘要内容', source: 'conversation-claude', nature: 'session_summary' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(row);
    expect(res.body.status).toBe('clarified');
    expect(pool.query).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/INSERT INTO captures[\s\S]*RETURNING id, status, dedupe_key, created_at/),
      ['摘要内容', 'conversation-claude', 'session_summary', null, null, null, null, null, null, 'clarified'],
    );
  });

  it('非法 source 仍被 400 拒绝', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'not-a-real-source' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
    expect(res.body.error).toMatch(/source must be one of/);
  });
});
