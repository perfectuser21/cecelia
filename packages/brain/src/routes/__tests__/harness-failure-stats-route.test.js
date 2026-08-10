/**
 * harness-failure-stats-route.test.js — GET /failure-stats 路由层 brain-unit 覆盖测试。
 *
 * 目的：覆盖路由 handler 的 IO 组装与 400/200 分支（brain-unit 无 DB，走 supertest + stub pool）。
 * 说明（禁 mock 边）：failure-stats handler ↔ tasks 的「真 Postgres 聚合真值」由
 * sprints/08111600-harness-failure-observability/tests/failure-stats-route.test.ts（打真 Brain）
 * 与 real-env-smoke（真 Brain + 真 PG）验收；本 unit 只验 HTTP 契约（状态码/响应形状/字段名），
 * 不主张验证 DB 聚合语义，stub 仅用于驱动 handler 走通两段查询。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /failure-stats 路由契约', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../db.js')).default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('days=7 → 200 + failure_rate(number) + by_class(object) + 计量字段，无 period_days', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '12' }] })
      .mockResolvedValueOnce({ rows: [
        { failure_class: 'watchdog_deadline', cnt: '3' },
        { failure_class: 'unclassified', cnt: '2' },
      ] });
    const res = await request(app).get('/failure-stats?days=7');
    expect(res.status).toBe(200);
    expect(typeof res.body.failure_rate).toBe('number');
    expect(res.body.failure_rate).toBe(0.42);
    expect(typeof res.body.by_class).toBe('object');
    expect(res.body.by_class).toEqual({ watchdog_deadline: 3, unclassified: 2 });
    expect(res.body.window_days).toBe(7);
    expect(res.body.total_tasks).toBe(12);
    expect(res.body.terminal_failed_count).toBe(5);
    expect(res.body).not.toHaveProperty('period_days');
    // by_class 求和 == terminal_failed_count（无双重计数）
    const sum = Object.values(res.body.by_class).reduce((a, b) => a + b, 0);
    expect(sum).toBe(res.body.terminal_failed_count);
  });

  it('缺省 days → 200 且 window_days=7', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/failure-stats');
    expect(res.status).toBe(200);
    expect(res.body.window_days).toBe(7);
    expect(res.body.failure_rate).toBe(0);
    expect(res.body.by_class).toEqual({});
    expect(res.body.total_tasks).toBe(0);
  });

  it('非法 days=abc → 400 + error(string)，不查库、不 500', async () => {
    const res = await request(app).get('/failure-stats?days=abc');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('越界 days=0 → 400', async () => {
    const res = await request(app).get('/failure-stats?days=0');
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 抛错 → 500 + error 字段（不静默）', async () => {
    pool.query.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).get('/failure-stats?days=7');
    expect(res.status).toBe(500);
    expect(typeof res.body.error).toBe('string');
  });
});
