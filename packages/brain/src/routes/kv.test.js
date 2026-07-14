/**
 * kv.test.js — /api/brain/kv/:key 通用存取路由单测
 *
 * 覆盖：
 *   1. GET 有数据 → 200 { key, updated_at, ...value_json }
 *   2. GET 无数据 → 404
 *   3. GET DB 异常 → 500
 *   4. POST 合法 object → upsert + 200 { ok:true, key, updated_at }
 *   5. POST 非 object body（数组）→ 400
 *   6. POST 非 object body（字符串）→ 400
 *   7. POST DB 异常 → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import pool from '../db.js';
import kvRouter from './kv.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/kv', kvRouter);
  return app;
}

const sampleValue = { pass: true, hard_faults: 0, rings: [], available: true };

describe('KV routes — GET /api/brain/kv/:key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('有数据 → 200 with key + updated_at + value fields', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ value_json: sampleValue, updated_at: '2026-07-14T07:00:00.000Z' }],
    });

    const res = await request(makeApp()).get('/api/brain/kv/seven-ring-audit-last');

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('seven-ring-audit-last');
    expect(res.body.updated_at).toBe('2026-07-14T07:00:00.000Z');
    expect(res.body.pass).toBe(true);
    expect(res.body.hard_faults).toBe(0);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('working_memory');
    expect(params[0]).toBe('seven-ring-audit-last');
  });

  it('无数据 → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(makeApp()).get('/api/brain/kv/nonexistent-key');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not found');
  });

  it('DB 异常 → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(makeApp()).get('/api/brain/kv/some-key');

    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('KV routes — POST /api/brain/kv/:key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('合法 object → upsert working_memory + 返回 ok', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ updated_at: '2026-07-14T10:00:00.000Z' }],
    });

    const res = await request(makeApp())
      .post('/api/brain/kv/seven-ring-audit-last')
      .send(sampleValue);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.key).toBe('seven-ring-audit-last');
    expect(res.body.updated_at).toBeTruthy();

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('working_memory');
    expect(sql).toContain('ON CONFLICT');
    expect(params[0]).toBe('seven-ring-audit-last');
    expect(JSON.parse(params[1]).pass).toBe(true);
  });

  it('array body → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/kv/some-key')
      .send([1, 2, 3]);

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('string body → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/kv/some-key')
      .set('Content-Type', 'application/json')
      .send('"hello"');

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 异常 → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(makeApp())
      .post('/api/brain/kv/some-key')
      .send(sampleValue);

    expect(res.status).toBe(500);
  });
});
