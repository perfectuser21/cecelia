/**
 * kv.test.js — /api/brain/kv/:key 路由单测
 *
 * 存储复用 working_memory（mock pool）
 * 覆盖：
 *   1. GET 存在的 key → {key, value, updated_at}
 *   2. GET 不存在的 key → 404
 *   3. POST 合法 body → upsert，返回 {ok:true, key, updated_at}
 *   4. POST 无 body → 400
 *   5. GET DB 异常 → 500
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

const FAKE_ROW = {
  key: 'seven-ring-audit-last',
  value_json: { pass: true, hard_fails: 0, run_at: '2026-07-14T00:00:00Z' },
  updated_at: '2026-07-14T11:00:00.000Z',
};

describe('kv routes — working_memory 存取', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET 存在的 key → 200 {key, value, updated_at}', async () => {
    pool.query.mockResolvedValueOnce({ rows: [FAKE_ROW] });
    const res = await request(makeApp()).get('/api/brain/kv/seven-ring-audit-last');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe('seven-ring-audit-last');
    expect(res.body.value).toEqual(FAKE_ROW.value_json);
    expect(res.body.updated_at).toBe(FAKE_ROW.updated_at);
  });

  it('GET 不存在的 key → 404', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/kv/no-such-key');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('POST 合法 body → 200 {ok:true, key, updated_at}', async () => {
    const fakeUpdatedAt = '2026-07-14T12:00:00.000Z';
    pool.query.mockResolvedValueOnce({ rows: [{ updated_at: fakeUpdatedAt }] });
    const payload = { pass: true, hard_fails: 0 };
    const res = await request(makeApp())
      .post('/api/brain/kv/seven-ring-audit-last')
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.key).toBe('seven-ring-audit-last');
    expect(res.body.updated_at).toBe(fakeUpdatedAt);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO working_memory'),
      expect.arrayContaining(['seven-ring-audit-last'])
    );
  });

  it('POST 空 body → 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/kv/my-key')
      .set('Content-Type', 'application/json')
      .send('null');
    expect(res.status).toBe(400);
  });

  it('GET DB 异常 → 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(makeApp()).get('/api/brain/kv/any-key');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/DB down/);
  });
});
