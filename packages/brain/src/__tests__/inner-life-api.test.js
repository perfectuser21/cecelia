/**
 * Inner Life API Tests
 * GET /api/brain/inner-life
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('../rumination.js', () => ({
  DAILY_BUDGET: 10,
}));

import pool from '../db.js';
import router from '../routes/inner-life.js';

const app = express();
app.use(express.json());
app.use('/api/brain/inner-life', router);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/brain/inner-life', () => {
  it('返回聚合的内心活动数据', async () => {
    // Mock 4 个并行查询
    pool.query
      .mockResolvedValueOnce({ rows: [{ value_json: '15.5' }] })  // accumulator
      .mockResolvedValueOnce({ rows: [                             // insights
        { id: 'i1', content: '[反刍洞察] RAG 可用', importance: 7, memory_type: 'long', created_at: new Date().toISOString() },
        { id: 'i2', content: '[反思洞察] CI 不足', importance: 8, memory_type: 'long', created_at: new Date().toISOString() },
      ]})
      .mockResolvedValueOnce({ rows: [{ pending: '3', expressed: '1', total: '5' }] })  // desire stats
      .mockResolvedValueOnce({ rows: [{ cnt: '2' }] });  // undigested count

    const res = await request(app).get('/api/brain/inner-life');

    expect(res.status).toBe(200);
    expect(res.body.rumination).toEqual({
      daily_budget: 10,
      undigested_count: 2,
    });
    expect(res.body.reflection).toEqual({
      accumulator: 15.5,
      threshold: 30,
      progress_pct: 52,
    });
    expect(res.body.insights).toHaveLength(2);
    expect(res.body.insights[0].type).toBe('rumination');
    expect(res.body.insights[1].type).toBe('reflection');
    expect(res.body.desires).toEqual({
      pending: 3,
      expressed: 1,
      total: 5,
    });
  });

  it('accumulator 为空时返回 0', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })       // no accumulator
      .mockResolvedValueOnce({ rows: [] })        // no insights
      .mockResolvedValueOnce({ rows: [{ pending: '0', expressed: '0', total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const res = await request(app).get('/api/brain/inner-life');

    expect(res.status).toBe(200);
    expect(res.body.reflection.accumulator).toBe(0);
    expect(res.body.reflection.progress_pct).toBe(0);
    expect(res.body.insights).toHaveLength(0);
    expect(res.body.rumination.undigested_count).toBe(0);
  });

  it('数据库错误返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/brain/inner-life');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
