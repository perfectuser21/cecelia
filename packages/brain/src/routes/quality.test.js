/**
 * quality.test.js — /api/brain/quality/test-pyramid 存取路由单测（TDD Red 阶段）
 *
 * 存储复用 working_memory KV 表（key='quality_test_pyramid'），mock pool。
 * 覆盖：
 *   1. POST 合法 guard JSON → upsert working_memory，返回 {ok:true, updated_at}
 *   2. POST 非法 body（缺 pass 布尔）→ 400
 *   3. GET 有数据 → {available:true, updated_at, ...存储的JSON}
 *   4. GET 无数据 → {available:false}
 *   5. GET DB 异常 → 200 {available:false, error}（面板灰态数据，不 500）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import pool from '../db.js';
import qualityRouter from './quality.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/quality', qualityRouter);
  return app;
}

const guardPayload = {
  pass: true,
  failures: [],
  orphans: { tests: 0, e2e: 0, total: 0 },
  smoke: { total: 2, unwired: [] },
  permanent: { total: 1123, layers: { unit: 1020, integration: 103 } },
  panel: { fresh: true, generated: '2026-07-14 10:59:31' },
};

describe('quality routes — test-pyramid 快照存取', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('POST /api/brain/quality/test-pyramid', () => {
    it('合法 guard JSON → upsert working_memory（key=quality_test_pyramid）+ 返回 ok', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ updated_at: '2026-07-14T07:00:00.000Z' }],
      });

      const res = await request(makeApp())
        .post('/api/brain/quality/test-pyramid')
        .send(guardPayload);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.updated_at).toBeTruthy();

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('working_memory');
      expect(sql).toContain('ON CONFLICT');
      expect(params[0]).toBe('quality_test_pyramid');
      expect(JSON.parse(params[1]).pass).toBe(true);
    });

    it('guard FAIL 快照（pass:false）同样接受存储', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ updated_at: '2026-07-14T07:00:00.000Z' }],
      });

      const res = await request(makeApp())
        .post('/api/brain/quality/test-pyramid')
        .send({ ...guardPayload, pass: false, failures: ['x 未挂跑道'] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('非法 body（缺 pass 布尔）→ 400', async () => {
      const res = await request(makeApp())
        .post('/api/brain/quality/test-pyramid')
        .send({ hello: 'world' });

      expect(res.status).toBe(400);
      expect(typeof res.body.error).toBe('string');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('DB 异常 → 500', async () => {
      pool.query.mockRejectedValueOnce(new Error('db down'));

      const res = await request(makeApp())
        .post('/api/brain/quality/test-pyramid')
        .send(guardPayload);

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/brain/quality/test-pyramid', () => {
    it('有数据 → {available:true, updated_at, ...存储的JSON}', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            value_json: guardPayload,
            updated_at: '2026-07-14T07:00:00.000Z',
          },
        ],
      });

      const res = await request(makeApp()).get('/api/brain/quality/test-pyramid');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      expect(res.body.updated_at).toBe('2026-07-14T07:00:00.000Z');
      expect(res.body.pass).toBe(true);
      expect(res.body.permanent.layers.unit).toBe(1020);
      expect(res.body.smoke.total).toBe(2);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('working_memory');
      expect(params[0]).toBe('quality_test_pyramid');
    });

    it('无数据 → {available:false}', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(makeApp()).get('/api/brain/quality/test-pyramid');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
    });

    it('DB 异常 → 200 {available:false, error}（面板灰态，不 500）', async () => {
      pool.query.mockRejectedValueOnce(new Error('db down'));

      const res = await request(makeApp()).get('/api/brain/quality/test-pyramid');

      expect(res.status).toBe(200);
      expect(res.body.available).toBe(false);
      expect(typeof res.body.error).toBe('string');
    });
  });
});
