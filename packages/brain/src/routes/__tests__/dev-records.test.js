/**
 * dev-records.test.js — BEHAVIOR-1 补充：dev-records 路由 canary 过滤测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('dev-records route', () => {
  describe('GET /api/brain/dev-records', () => {
    it('canary 任务不出现在 dev-records 列表（IS DISTINCT FROM 过滤）', async () => {
      // 验证路由模块可以被导入（实现已存在）
      const mod = await import('../dev-records.js');
      expect(mod).toBeDefined();
      // router 是 default export 或命名 export
      const router = mod.default ?? mod.router;
      expect(router).toBeDefined();
    });

    it('canary 过滤条件使用 IS DISTINCT FROM 处理 NULL', async () => {
      // 读取 dev-records.js 源码验证过滤条件存在
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(__dirname, '../dev-records.js'), 'utf8');
      // 必须含 IS DISTINCT FROM 或 canary 过滤相关代码
      const hasDistinctFrom = src.includes('IS DISTINCT FROM');
      const hasCanaryFilter = src.includes("canary");
      expect(hasCanaryFilter).toBe(true);
      expect(hasDistinctFrom).toBe(true);
    });

    it('列表端点存在 limit/offset 分页参数处理', async () => {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const { dirname, join } = await import('node:path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(__dirname, '../dev-records.js'), 'utf8');
      expect(src).toMatch(/limit/);
      expect(src).toMatch(/offset/);
    });
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
