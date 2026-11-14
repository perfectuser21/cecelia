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
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api/brain/cognitive-map', router);

beforeEach(() => {
  vi.clearAllMocks();
  pool.query.mockReset();
});

describe('GET /api/brain/cognitive-map', () => {
  it('返回 15 个子系统和 17 条连接定义', async () => {
    const now = new Date().toISOString();
    // Mock 15 个并行查询
    pool.query
      .mockResolvedValueOnce({ rows: [{ updated_at: now }] })                  // tick
      .mockResolvedValueOnce({ rows: [{ cnt: '135', last_at: now }] })         // dispatch attempts
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
    expect(res.body.subsystems.find(node => node.id === 'planner').name).toBe('队列选择');
    expect(res.body.connections).toHaveLength(17);
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

  function queueEvidence(dispatch, heartbeat = new Date().toISOString()) {
    pool.query.mockImplementation(async sql => {
      if (sql.includes("key = 'tick_last'")) return { rows: heartbeat ? [{ updated_at: heartbeat }] : [] };
      if (/FROM dispatch_events/.test(sql)) {
        expect(sql).toMatch(/event_type IN \('dispatched', 'failed_dispatch'\)/);
        expect(sql).toMatch(/created_at > CURRENT_DATE/);
        return { rows: [dispatch] };
      }
      if (/source IN \('planner', 'tick'\)/.test(sql)) return { rows: [{ cnt: '999', last_at: heartbeat }] };
      return { rows: [] };
    });
  }

  it('旧tick/planner事件不能冒充队列活动，心跳没有今日累计时明确未知', async () => {
    const heartbeat = new Date().toISOString();
    queueEvidence({ cnt: '0', last_at: null }, heartbeat);
    const res = await request(app).get('/api/brain/cognitive-map');
    expect(res.status).toBe(200);
    const queue = res.body.subsystems.find(node => node.id === 'planner');
    expect(queue.status).toBe('dormant');
    expect(queue.metrics.today_count).toBe(0);
    expect(queue.metrics.last_active_at).toBeNull();
    const tick = res.body.subsystems.find(node => node.id === 'tick');
    expect(tick.status).toBe('active');
    expect(tick.metrics.today_count).toBeNull();
    expect(tick.metrics.last_active_at).toBe(heartbeat);
  });

  it('真实成功或失败派发尝试才显示队列活动，次数不混入旧心跳', async () => {
    const now = new Date().toISOString();
    queueEvidence({ cnt: '2', last_at: now });
    const res = await request(app).get('/api/brain/cognitive-map');
    expect(res.status).toBe(200);
    const queue = res.body.subsystems.find(node => node.id === 'planner');
    expect(queue.status).toBe('active');
    expect(queue.metrics).toMatchObject({ today_count: 2, last_active_at: now });
    expect(res.body.subsystems.find(node => node.id === 'tick').metrics.today_count).toBeNull();
  });

  it('真实派发30分钟后保持idle，无心跳记录不能显示活动', async () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      queueEvidence({ cnt: '1', last_at: new Date(now - 31 * 60 * 1000).toISOString() }, null);
      const res = await request(app).get('/api/brain/cognitive-map');
      expect(res.status).toBe(200);
      expect(res.body.subsystems.find(node => node.id === 'planner').status).toBe('idle');
      expect(res.body.subsystems.find(node => node.id === 'tick').status).toBe('dormant');
    } finally { clock.mockRestore(); }
  });

  it('独立IP允许1200次图读取；未匹配穿透不耗预算，429不再查询数据库', async () => {
    let queries = 0;
    pool.query.mockImplementation(async () => { queries++; return { rows: [] }; });
    const ip = '203.0.113.81';
    const unmatched = await request(app).get('/api/brain/cognitive-map/unrelated').set('X-Forwarded-For', ip);
    expect(unmatched.status).toBe(404);
    expect(unmatched.headers.ratelimit).toBeUndefined();
    expect(queries).toBe(0);
    for (let index = 0; index < 1200; index++) {
      const response = await request(app).get('/api/brain/cognitive-map').set('X-Forwarded-For', ip);
      expect(response.status, `合法读取第${index + 1}次`).toBe(200);
      pool.query.mockClear();
    }
    expect(queries).toBeGreaterThan(0);
    const beforeBlocked = queries;
    const blocked = await request(app).get('/api/brain/cognitive-map').set('X-Forwarded-For', ip);
    expect(blocked.status).toBe(429);
    expect(queries).toBe(beforeBlocked);
    expect(pool.query).not.toHaveBeenCalled();
  }, 30000);

  it('数据库错误返回 500', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/brain/cognitive-map');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});
