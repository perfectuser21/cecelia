import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));

describe('GET /api/brain/task-router/diagnose', () => {
  it('returns status ok and usage hint', async () => {
    const router = (await import('../task-router-diagnose.js')).default;

    // 找到 GET /diagnose handler（无参数版本）
    const layer = router.stack.find(l => l.route?.path === '/diagnose' && l.route?.methods?.get);
    expect(layer).toBeDefined();

    const req = {};
    const res = { json: vi.fn() };
    await layer.route.stack[0].handle(req, res, vi.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', usage: expect.stringContaining(':kr_id') })
    );
  });
});


describe('诊断请求准入限流（永久 HTTP 回归）', () => {
  it('同一来源一分钟第 31 次诊断返回429且不访问DB，切换 KR 无法重置预算，健康入口仍可读', async () => {
    vi.resetModules();
    const pool = (await import('../../db.js')).default;
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
    const router = (await import('../task-router-diagnose.js')).default;
    const app = express();
    app.use('/api/brain/task-router', router);
    const server = await new Promise(resolve => {
      const listening = app.listen(0, () => resolve(listening));
    });
    const client = request(server);
    const krIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
    try {
      for (let index = 0; index < 30; index++) {
        const response = await client.get(`/api/brain/task-router/diagnose/${krIds[index % 2]}`);
        expect(response.status, `诊断请求 ${index + 1}`).toBe(404);
      }
      expect(pool.query).toHaveBeenCalledTimes(30);
      const blocked = await client.get('/api/brain/task-router/diagnose/33333333-3333-3333-3333-333333333333');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual({ error: 'diagnose_rate_limit_exceeded' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(pool.query).toHaveBeenCalledTimes(30);
      const health = await client.get('/api/brain/task-router/diagnose');
      expect(health.status).toBe(200);
      expect(health.body.status).toBe('ok');
      expect(pool.query).toHaveBeenCalledTimes(30);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
