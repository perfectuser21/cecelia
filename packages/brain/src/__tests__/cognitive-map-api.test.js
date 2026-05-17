/**
 * Cognitive Map API Tests
 * GET /api/brain/cognitive-map
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

import pool from '../db.js';
import router from '../routes/cognitive-map.js';

const app = express();
app.use(express.json());
app.use('/api/brain/cognitive-map', router);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/brain/cognitive-map', () => {
  it('返回 15 个子系统和 21 条连接', async () => {
    const now = new Date().toISOString();
    // Mock 15 个并行查询
    pool.query
      .mockResolvedValueOnce({ rows: [{ updated_at: now }] })                  // tick
      .mockResolvedValueOnce({ rows: [{ cnt: '135', last_at: now }] })         // planner
      .mockResolvedValueOnce({ rows: [{ cnt: '2', last_at: now }] })           // executor
      .mockResolvedValueOnce({ rows: [{ cnt: '663', last_at: now, l0_count: '661', l1_count: '0', l2_count: '0' }] }) // thalamus
      .mockResolvedValueOnce({ rows: [{ cnt: '5', last_at: now }] })           // cortex
      .mockResolvedValueOnce({ rows: [{ value_json: '{"mood":"calm"}', updated_at: now }] }) // emotion wm
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })                         // emotion ms
      .mockResolvedValueOnce({ rows: [{ cnt: '10', pending: '2', last_at: now }] })  // desire
      .mockResolvedValueOnce({ rows: [{ cnt: '50', last_at: now }] })          // memory
      .mockResolvedValueOnce({ rows: [{ undigested: '5', today_cnt: '3', last_at: now }] }) // rumination
      .mockResolvedValueOnce({ rows: [{ cnt: '3', last_at: now }] })           // learning
      .mockResolvedValueOnce({ rows: [{ cnt: '1', last_at: now }] })           // self_model
      .mockResolvedValueOnce({ rows: [{ cnt: '8', pending: '3', last_at: now }] }) // suggestion
      .mockResolvedValueOnce({ rows: [{ cnt: '0', last_at: null }] })          // immune
      .mockResolvedValueOnce({ rows: [{ cnt: '12', last_at: now }] });         // dialog

    const res = await request(app).get('/api/brain/cognitive-map');

    expect(res.status).toBe(200);
    expect(res.body.subsystems).toHaveLength(15);
    expect(res.body.connections).toHaveLength(21);
    expect(res.body.snapshot_at).toBeTruthy();

    // 验证子系统 ID 完整性
    const ids = res.body.subsystems.map(s => s.id);
    expect(ids).toContain('tick');
    expect(ids).toContain('thalamus');
    expect(ids).toContain('emotion');
    expect(ids).toContain('memory');
    expect(ids).toContain('dialog');

    // 验证 thalamus 有 extra 指标
    const thalamus = res.body.subsystems.find(s => s.id === 'thalamus');
    expect(thalamus.metrics.extra.l0_count).toBe(661);
    expect(thalamus.group).toBe('cognition');
  });

  it('数据库无数据时所有子系统为 dormant', async () => {
    // 15 个空查询
    for (let i = 0; i < 15; i++) {
      pool.query.mockResolvedValueOnce({ rows: [{}] });
    }

    const res = await request(app).get('/api/brain/cognitive-map');

    expect(res.status).toBe(200);
    expect(res.body.subsystems).toHaveLength(15);
    // 大部分应为 dormant
    const dormantCount = res.body.subsystems.filter(s => s.status === 'dormant').length;
    expect(dormantCount).toBeGreaterThanOrEqual(10);
  });

  it('数据库错误返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/brain/cognitive-map');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
