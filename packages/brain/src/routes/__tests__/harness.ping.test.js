import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /ping', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('响应体 ok 字段为布尔 true', async () => {
    const res = await request(app).get('/ping');
    expect(res.body.ok).toBe(true);
  });

  it('响应体 ts 字段为 ISO 8601 string', async () => {
    const res = await request(app).get('/ping');
    expect(typeof res.body.ts).toBe('string');
    expect(() => new Date(res.body.ts).toISOString()).not.toThrow();
    expect(new Date(res.body.ts).toISOString()).toBe(res.body.ts);
  });

  it('响应体 keys 严格等于 ["ok","ts"]', async () => {
    const res = await request(app).get('/ping');
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'ts'].sort());
  });

  it('禁用字段 status/alive/pong/timestamp 均不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('alive');
    expect(res.body).not.toHaveProperty('pong');
    expect(res.body).not.toHaveProperty('timestamp');
  });

  it('error path — 未注册路由返回非 200（防 404 假绿）', async () => {
    const emptyApp = express();
    const res = await request(emptyApp).get('/ping');
    expect(res.status).not.toBe(200);
  });
});
