/**
 * routes/harness.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';

vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('routes/harness module (pairing stub)', () => {
  it('routes/harness.js 已删 harness_planner SQL（仅注释残留）', () => {
    const src = fs.readFileSync(new URL('../harness.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/task_type\s*=\s*['"]harness_planner['"]/i);
  });
});

describe('GET /runs', () => {
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

  it('默认 limit=20 返回数组', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const callArgs = pool.query.mock.calls[0];
    expect(callArgs[1][0]).toBe(20);
  });

  it('?limit=5 透传到 SQL', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs?limit=5');
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1][0]).toBe(5);
  });

  it('空表返回 []', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('limit=0 返回 400', async () => {
    const res = await request(app).get('/runs?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 and 100/);
  });

  it('limit=101 返回 400', async () => {
    const res = await request(app).get('/runs?limit=101');
    expect(res.status).toBe(400);
  });

  it('limit=abc 返回 400', async () => {
    const res = await request(app).get('/runs?limit=abc');
    expect(res.status).toBe(400);
  });

  it('返回字段包含 id/initiative_id/phase/journey_type/started_at/completed_at/failure_reason', async () => {
    const mockRow = {
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      initiative_id: 'bbbbbbbb-0000-0000-0000-000000000000',
      phase: 'done',
      journey_type: 'dev_pipeline',
      started_at: '2026-05-31T00:00:00Z',
      completed_at: '2026-05-31T01:00:00Z',
      failure_reason: null,
    };
    pool.query.mockResolvedValueOnce({ rows: [mockRow] });
    const res = await request(app).get('/runs');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject(mockRow);
  });
});
