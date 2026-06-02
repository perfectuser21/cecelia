/**
 * GET /runs/recent — 最近 3 条 initiative_runs 记录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('GET /runs/recent', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('空表返回 [] HTTP 200', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs/recent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('返回数组，最多 3 条', async () => {
    const mockRows = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', phase: 'done', started_at: '2026-06-02T03:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', phase: 'running', started_at: '2026-06-02T02:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', phase: 'failed', started_at: '2026-06-02T01:00:00Z' },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows });
    const res = await request(app).get('/runs/recent');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(3);
  });

  it('每条记录只含 id、phase、started_at 三个字段', async () => {
    const mockRows = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', phase: 'done', started_at: '2026-06-02T03:00:00Z' },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows });
    const res = await request(app).get('/runs/recent');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'phase', 'started_at']);
  });

  it('超过 3 条数据时 SQL 已 LIMIT 3，仅返回最新 3 条', async () => {
    const mockRows = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', phase: 'done', started_at: '2026-06-02T04:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', phase: 'done', started_at: '2026-06-02T03:00:00Z' },
      { id: 'aaaaaaaa-0000-0000-0000-000000000003', phase: 'done', started_at: '2026-06-02T02:00:00Z' },
    ];
    pool.query.mockResolvedValueOnce({ rows: mockRows });
    const res = await request(app).get('/runs/recent');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/LIMIT\s+3/i);
    expect(sql).toMatch(/ORDER BY started_at DESC/i);
  });
});
