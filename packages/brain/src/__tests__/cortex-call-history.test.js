/**
 * Cortex Call History API Tests
 * GET /api/brain/cortex/call-history
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import router from '../routes/cortex.js';

const app = express();
app.use(express.json());
app.use('/api/brain/cortex', router);

const TIMEOUT_MS = parseInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS || '120000', 10);
const TIMEOUT_THRESHOLD = TIMEOUT_MS - 5000;

function makeRow(overrides = {}) {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    ts: new Date().toISOString(),
    trigger: 'systemic_failure',
    status: 'success',
    duration_ms: 1000,
    http_status: null,
    model: 'claude-opus-4-6',
    error_summary: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/brain/cortex/call-history', () => {
  it('无参数时返回 200 和记录列表', async () => {
    const rows = [makeRow(), makeRow({ status: 'failed', error_summary: 'timeout' })];
    pool.query.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/brain/cortex/call-history');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.query).toBeUndefined(); // sanity
  });

  it('?status=failed 只返回失败记录', async () => {
    const row = makeRow({ status: 'failed', http_status: 500, error_summary: 'API error' });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).get('/api/brain/cortex/call-history?status=failed');

    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe('failed');
    // 验证 SQL 传入 'failed'
    expect(pool.query.mock.calls[0][1]).toContain('failed');
  });

  it('?status=timeout 查询 success 行且 duration_ms >= threshold', async () => {
    const row = makeRow({ duration_ms: TIMEOUT_THRESHOLD + 1000 });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).get('/api/brain/cortex/call-history?status=timeout');

    expect(res.status).toBe(200);
    // 响应中 status 应为 'timeout'（派生）
    expect(res.body[0].status).toBe('timeout');
    // SQL 参数应含 TIMEOUT_THRESHOLD
    expect(pool.query.mock.calls[0][1]).toContain(TIMEOUT_THRESHOLD);
  });

  it('duration_ms < threshold 的 success 行不被标记为 timeout', async () => {
    const row = makeRow({ duration_ms: 1000 }); // 远低于阈值
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).get('/api/brain/cortex/call-history');

    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe('success');
  });

  it('?status=invalid 返回 400', async () => {
    const res = await request(app).get('/api/brain/cortex/call-history?status=invalid');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid status/);
  });

  it('?limit=abc 返回 400', async () => {
    const res = await request(app).get('/api/brain/cortex/call-history?limit=abc');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });

  it('?limit=250 超上限返回 400', async () => {
    const res = await request(app).get('/api/brain/cortex/call-history?limit=250');

    expect(res.status).toBe(400);
  });

  it('?limit=10 SQL 参数包含 10', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/brain/cortex/call-history?limit=10');

    expect(pool.query.mock.calls[0][1]).toContain(10);
  });

  it('数据库异常返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await request(app).get('/api/brain/cortex/call-history');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/DB connection lost/);
  });

  it('返回字段包含 id/ts/trigger/status/duration_ms/http_status/model/error_summary', async () => {
    const row = makeRow({ http_status: 429, status: 'failed', error_summary: 'rate limited' });
    pool.query.mockResolvedValueOnce({ rows: [row] });

    const res = await request(app).get('/api/brain/cortex/call-history');

    const record = res.body[0];
    expect(record).toHaveProperty('id');
    expect(record).toHaveProperty('ts');
    expect(record).toHaveProperty('trigger');
    expect(record).toHaveProperty('status');
    expect(record).toHaveProperty('duration_ms');
    expect(record).toHaveProperty('http_status', 429);
    expect(record).toHaveProperty('model');
    expect(record).toHaveProperty('error_summary', 'rate limited');
  });
});
