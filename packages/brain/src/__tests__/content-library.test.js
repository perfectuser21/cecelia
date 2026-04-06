/**
 * content-library.test.js
 *
 * 内容库 API 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock db.js ─────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db.js';

// ─── Mock express router to capture route handlers ───────────────────────────

const routes = {};
const mockRouter = {
  get: (path, handler) => { routes[`GET:${path}`] = handler; },
  patch: (path, handler) => { routes[`PATCH:${path}`] = handler; },
};

vi.mock('express', () => ({
  Router: () => mockRouter,
  default: { Router: () => mockRouter },
}));

// Import after mocks
const { default: contentLibraryRouter } = await import('../routes/content-library.js');

// ─── Helper: mock res ─────────────────────────────────────────────────────────

function makeRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /content-library', () => {
  beforeEach(() => { pool.query.mockReset(); });

  it('返回 {data, total} 结构', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const req = { query: {} };
    const res = makeRes();
    await routes['GET:/']?.(req, res);
    expect(res._body).toHaveProperty('data');
    expect(res._body).toHaveProperty('total');
    expect(Array.isArray(res._body.data)).toBe(true);
  });

  it('date 参数正确传入 SQL', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const req = { query: { date: '2026-04-06' } };
    const res = makeRes();
    await routes['GET:/']?.(req, res);
    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toContain('2026-04-06');
  });

  it('DB 异常时返回 500', async () => {
    pool.query.mockRejectedValue(new Error('DB error'));
    const req = { query: {} };
    const res = makeRes();
    await routes['GET:/']?.(req, res);
    expect(res._status).toBe(500);
  });
});

describe('GET /content-library/stats', () => {
  beforeEach(() => { pool.query.mockReset(); });

  it('返回 {stats, kr_target, summary} 结构', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { date: '2026-04-05', total_completed: '5', approved: '2', rejected: '0', needs_revision: '1', pending_review: '2' },
        { date: '2026-04-06', total_completed: '2', approved: '0', rejected: '0', needs_revision: '0', pending_review: '2' },
      ],
    });
    const req = { query: {} };
    const res = makeRes();
    await routes['GET:/stats']?.(req, res);
    expect(res._body.kr_target).toBe(3);
    expect(res._body.summary).toHaveProperty('days_tracked');
    expect(res._body.summary).toHaveProperty('days_met_target');
    expect(res._body.stats[0].met_target).toBe(true);  // 5 >= 3
    expect(res._body.stats[1].met_target).toBe(false); // 2 < 3
  });
});

describe('PATCH /content-library/:id/review', () => {
  beforeEach(() => { pool.query.mockReset(); });

  it('invalid status 返回 400', async () => {
    const req = { params: { id: 'abc' }, body: { status: 'invalid' } };
    const res = makeRes();
    await routes['PATCH:/:id/review']?.(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/status/);
  });

  it('approved 状态更新成功', async () => {
    pool.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'abc', review_status: 'approved' }],
    });
    const req = { params: { id: 'abc' }, body: { status: 'approved', feedback: '写得很好' } };
    const res = makeRes();
    await routes['PATCH:/:id/review']?.(req, res);
    expect(res._body.ok).toBe(true);
    expect(res._body.review_status).toBe('approved');
  });

  it('needs-revision 是合法状态', async () => {
    pool.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: 'xyz', review_status: 'needs-revision' }],
    });
    const req = { params: { id: 'xyz' }, body: { status: 'needs-revision', feedback: '数据需核实' } };
    const res = makeRes();
    await routes['PATCH:/:id/review']?.(req, res);
    expect(res._body.ok).toBe(true);
  });

  it('pipeline 不存在时返回 404', async () => {
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
    const req = { params: { id: 'notfound' }, body: { status: 'approved' } };
    const res = makeRes();
    await routes['PATCH:/:id/review']?.(req, res);
    expect(res._status).toBe(404);
  });
});

describe('_isFallbackError (topic-selector)', () => {
  it('识别 codex exec failed', async () => {
    const { _isFallbackError } = await import('../topic-selector.js');
    expect(_isFallbackError(new Error('codex exec failed (exit 1): quota'))).toBe(true);
    expect(_isFallbackError(new Error('usage limit exceeded'))).toBe(true);
    expect(_isFallbackError(new Error('stream disconnected'))).toBe(true);
    expect(_isFallbackError(new Error('random network error'))).toBe(false);
  });
});
