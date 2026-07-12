/**
 * golden-paths.js 路由单测
 * 覆盖：GET列表、POST建candidate、PATCH状态机流转（含非法流转拒）
 * 依据 T1 DoD F1/F6/F7，状态机 CHECK 见 migrations/334_golden_paths.sql
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

import goldenPathsRouter from '../golden-paths.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/golden-paths', goldenPathsRouter);
  return app;
}

const pool = (await import('../../db.js')).default;

const SAMPLE_ROW = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  title: 'Test GP',
  one_liner: 'A test golden path',
  status: 'candidate',
  source: 'strategist',
  auto_release: false,
  veto_deadline: null,
  approved_at: null,
  review_after: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('GET /api/brain/golden-paths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('无筛选返回列表', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ROW] });
    const res = await request(buildApp()).get('/api/brain/golden-paths');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('status= 筛选生效', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/brain/golden-paths?status=approved');
    expect(res.status).toBe(200);
    const callArg = pool.query.mock.calls[0][0];
    expect(callArg).toContain('status =');
  });

  it('非法 status 返回 400', async () => {
    const res = await request(buildApp()).get('/api/brain/golden-paths?status=nonexistent');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/);
  });
});

describe('POST /api/brain/golden-paths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('必填字段缺失返回 400', async () => {
    const res = await request(buildApp())
      .post('/api/brain/golden-paths')
      .send({ title: 'only title' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/one_liner/);
  });

  it('成功建 candidate 返回 201', async () => {
    pool.query.mockResolvedValueOnce({ rows: [SAMPLE_ROW] });
    const res = await request(buildApp())
      .post('/api/brain/golden-paths')
      .send({ title: 'Test GP', one_liner: 'A test golden path', source: 'strategist' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('非法 source 返回 400', async () => {
    const res = await request(buildApp())
      .post('/api/brain/golden-paths')
      .send({ title: 'Test GP', one_liner: 'ok', source: 'badactor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid source/);
  });
});

describe('PATCH /api/brain/golden-paths/:id — 状态机流转', () => {
  beforeEach(() => vi.clearAllMocks());

  it('合法流转：candidate → proposed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'candidate' }] })
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'proposed' }] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/${SAMPLE_ROW.id}`)
      .send({ status: 'proposed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('proposed');
  });

  it('非法流转：candidate → delivered 返回 422', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'candidate' }] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/${SAMPLE_ROW.id}`)
      .send({ status: 'delivered' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/illegal transition/);
  });

  it('非法流转：approved → candidate 返回 422', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'approved' }] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/${SAMPLE_ROW.id}`)
      .send({ status: 'candidate' });
    expect(res.status).toBe(422);
  });

  it('superseded 为最终态，任何流转返回 422', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'superseded' }] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/${SAMPLE_ROW.id}`)
      .send({ status: 'candidate' });
    expect(res.status).toBe(422);
  });

  it('不存在的 id 返回 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/00000000-0000-0000-0000-000000000000`)
      .send({ status: 'proposed' });
    expect(res.status).toBe(404);
  });

  it('合法流转：approved → expired（gp-shelf-life 调用场景）', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ ...SAMPLE_ROW, status: 'expired' }] });
    const res = await request(buildApp())
      .patch(`/api/brain/golden-paths/${SAMPLE_ROW.id}`)
      .send({ status: 'expired', status_reason: '超保质期未开工' });
    expect(res.status).toBe(200);
  });
});

describe('状态机完整性：所有10态均在 VALID_STATUSES', () => {
  const TEN_STATES = [
    'candidate', 'proposed', 'converged', 'approved', 'in_dev',
    'delivered', 'expired', 'rejected', 'blocked_gate', 'superseded',
  ];

  it.each(TEN_STATES)('状态 %s 是合法值（非法 status 查询不包含它）', async (state) => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(buildApp()).get(`/api/brain/golden-paths?status=${state}`);
    expect(res.status).toBe(200);
  });
});
