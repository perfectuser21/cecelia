/**
 * dev-records.test.js — BEHAVIOR-1 补充：dev-records 路由 canary 过滤测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('dev-records canary 查询合同', () => {
  it('真实列表与计数查询均排除TRUE且保留NULL；since两查询参数一致', async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async sql => ({ rows: sql.includes('count(*)') ? [{ count: '1' }] : [{ id: 'human-record' }] }));
    const { default: router } = await import('../dev-records.js');
    const app = express();
    app.use('/dev-records', router);
    const res = await request(app).get('/dev-records?limit=10&offset=2&since=2026-11-01');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data).toEqual([{ id: 'human-record' }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE is_canary IS DISTINCT FROM TRUE AND merged_at >= \$3/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/WHERE is_canary IS DISTINCT FROM TRUE AND merged_at >= \$1/);
    expect(mockQuery.mock.calls[0][1]).toEqual([10, 2, '2026-11-01']);
    // 计数没有分页参数，since占位符必须从$1开始。
    expect(mockQuery.mock.calls[1][1]).toEqual(['2026-11-01']);
  });
});

// 回归：limit=-1 曾被 parseInt 当真值传给 LIMIT，500 响应里带出数据库原文
describe('GET /api/brain/dev-records limit/offset 校验', () => {
  let app;

  beforeEach(async () => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql) => (
      sql.includes('count(*)') ? { rows: [{ count: '0' }] } : { rows: [] }
    ));
    const { default: router } = await import('../dev-records.js');
    app = express();
    app.use('/dev-records', router);
  });

  it('limit=-1 → 400，不查库、不泄露数据库原文', async () => {
    const res = await request(app).get('/dev-records?limit=-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('limit must be a non-negative integer');
    expect(JSON.stringify(res.body)).not.toContain('LIMIT must not be negative');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('limit=abc、offset=-5 → 400', async () => {
    const r1 = await request(app).get('/dev-records?limit=abc');
    expect(r1.status).toBe(400);
    expect(r1.body.error).toContain('limit must be a non-negative integer');
    const r2 = await request(app).get('/dev-records?offset=-5');
    expect(r2.status).toBe(400);
    expect(r2.body.error).toContain('offset must be a non-negative integer');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('limit=10 → 200，LIMIT 参数为 10', async () => {
    const res = await request(app).get('/dev-records?limit=10');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1][0]).toBe(10);
  });

  it('不传参数 → 200，参数为 [50, 0]', async () => {
    const res = await request(app).get('/dev-records');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([50, 0]);
  });

  it('查库抛错 → 500，响应体不含错误原文', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom db detail'));
    const res = await request(app).get('/dev-records');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('boom db detail');
  });
});
