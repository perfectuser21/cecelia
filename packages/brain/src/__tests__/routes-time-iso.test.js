/**
 * GET /api/brain/time/iso —— 时间路由骨架的端到端测试
 *
 * Task: 33b37ea3 (新增 /api/brain/time/iso 端点与路由骨架)
 *
 * BEHAVIOR DoD:
 *  - 200 + JSON, iso 字段可被标准 ISO8601 解析
 *  - iso 时刻与系统当前时间差不超过 5 秒
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

let app;

beforeAll(async () => {
  const mod = await import('../routes/time.js');
  const router = mod.default;
  app = express();
  app.use(express.json());
  app.use('/api/brain/time', router);
});

describe('GET /api/brain/time/iso', () => {
  it('returns HTTP 200 with JSON body containing iso field', async () => {
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toBeTypeOf('object');
    expect(typeof res.body.iso).toBe('string');
  });

  it('iso field parses as a valid ISO8601 timestamp', async () => {
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);

    const parsed = new Date(res.body.iso);
    expect(Number.isNaN(parsed.getTime())).toBe(false);

    // 严格 ISO8601：再用正则确认（Date 对部分非标格式也宽松）
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
  });

  it('iso timestamp is within 5 seconds of real system time', async () => {
    const before = Date.now();
    const res = await request(app).get('/api/brain/time/iso');
    const after = Date.now();
    expect(res.status).toBe(200);

    const ts = new Date(res.body.iso).getTime();
    // 服务端时间应介于请求前后窗口附近，宽松取 ±5 秒
    expect(ts).toBeGreaterThanOrEqual(before - 5000);
    expect(ts).toBeLessThanOrEqual(after + 5000);
  });
});
