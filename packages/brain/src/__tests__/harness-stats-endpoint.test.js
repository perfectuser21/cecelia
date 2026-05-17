/**
 * harness-stats-endpoint.test.js
 * 验证 routes/harness.js 中新增的 GET /stats 端点
 * 覆盖目标：/stats 路由处理逻辑（lines 518-583）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js — 路径从 src/__tests__/ 出发，../db.js → src/db.js
// routes/harness.js 中 import pool from '../db.js' 解析同一模块
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

// 延迟导入，确保 mock 先注册
const { default: harnessRouter } = await import('../routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

describe('GET /harness/stats', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('正常情况：返回完整统计字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '10' }] })          // total pipelines
      .mockResolvedValueOnce({ rows: [{ done: '8' }] })            // completed
      .mockResolvedValueOnce({ rows: [{ avg_rounds: '2.5' }] })    // avg GAN
      .mockResolvedValueOnce({ rows: [{ avg_ms: '300000' }] });    // avg duration

    const res = await request(app).get('/harness/stats');

    expect(res.status).toBe(200);
    expect(res.body.period_days).toBe(30);
    expect(res.body.total_pipelines).toBe(10);
    expect(res.body.completed_pipelines).toBe(8);
    expect(res.body.completion_rate).toBe(0.8);
    expect(res.body.avg_gan_rounds).toBe(2.5);
    expect(res.body.avg_duration).toBe(300000);
  });

  it('没有数据时：所有指标返回 0', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ done: '0' }] })
      .mockResolvedValueOnce({ rows: [{ avg_rounds: null }] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: null }] });

    const res = await request(app).get('/harness/stats');

    expect(res.status).toBe(200);
    expect(res.body.completion_rate).toBe(0);
    expect(res.body.avg_gan_rounds).toBe(0);
    expect(res.body.avg_duration).toBe(0);
    expect(res.body.total_pipelines).toBe(0);
  });

  it('completion_rate 精度：8/10 = 0.8', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '10' }] })
      .mockResolvedValueOnce({ rows: [{ done: '8' }] })
      .mockResolvedValueOnce({ rows: [{ avg_rounds: null }] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: null }] });

    const res = await request(app).get('/harness/stats');
    expect(res.body.completion_rate).toBe(0.8);
  });

  it('total=0 时 completion_rate 为 0（不除以零）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [{ done: '0' }] })
      .mockResolvedValueOnce({ rows: [{ avg_rounds: null }] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: null }] });

    const res = await request(app).get('/harness/stats');
    expect(res.body.completion_rate).toBe(0);
  });

  it('数据库错误：返回 500 和 error 字段', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection error'));

    const res = await request(app).get('/harness/stats');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('DB connection error');
  });

  it('avg_gan_rounds 保留两位小数', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '5' }] })
      .mockResolvedValueOnce({ rows: [{ done: '5' }] })
      .mockResolvedValueOnce({ rows: [{ avg_rounds: '3.333333' }] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: null }] });

    const res = await request(app).get('/harness/stats');
    expect(res.body.avg_gan_rounds).toBe(3.33);
  });

  it('avg_duration 取整（毫秒）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total: '3' }] })
      .mockResolvedValueOnce({ rows: [{ done: '3' }] })
      .mockResolvedValueOnce({ rows: [{ avg_rounds: null }] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: '123456.789' }] });

    const res = await request(app).get('/harness/stats');
    expect(res.body.avg_duration).toBe(123457);
  });
});
