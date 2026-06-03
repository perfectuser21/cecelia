/**
 * TDD Red 测试 — GET /api/brain/harness/healthz
 * 这些测试在 generator 实现 /healthz 路由之前全部 FAIL（Red 阶段）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /healthz [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routerMod = await import('../../../packages/brain/src/routes/harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });

  it('响应体 ok 字段为布尔 true', async () => {
    const res = await request(app).get('/healthz');
    expect(res.body.ok).toBe(true);
  });

  it('响应体 service 字段为字面量 "harness"', async () => {
    const res = await request(app).get('/healthz');
    expect(res.body.service).toBe('harness');
  });

  it('响应体 ts 字段为有效 ISO8601 string', async () => {
    const res = await request(app).get('/healthz');
    expect(typeof res.body.ts).toBe('string');
    const d = new Date(res.body.ts);
    expect(isNaN(d.getTime())).toBe(false);
  });

  it('响应体 keys 严格等于 ["ok","service","ts"]', async () => {
    const res = await request(app).get('/healthz');
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'service', 'ts'].sort());
  });

  it('禁用字段 status/healthy/name/timestamp 均不存在', async () => {
    const res = await request(app).get('/healthz');
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('healthy');
    expect(res.body).not.toHaveProperty('name');
    expect(res.body).not.toHaveProperty('timestamp');
  });

  it('error path — 未注册路由返回非 200（防 404 假绿）', async () => {
    const emptyApp = express();
    const res = await request(emptyApp).get('/healthz');
    expect(res.status).not.toBe(200);
  });
});
