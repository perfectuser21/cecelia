import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /ping', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    const routerMod = await import('../../../../../../../packages/brain/src/routes/harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('ok=true — 响应体 ok 字段固定为布尔 true', async () => {
    const res = await request(app).get('/ping');
    expect(res.body.ok).toBe(true);
  });

  it('ts ISO 8601 — ts 字段为 string 类型', async () => {
    const res = await request(app).get('/ping');
    expect(typeof res.body.ts).toBe('string');
    expect(res.body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('keys 完整性 — 严格等于 ok 和 ts', async () => {
    const res = await request(app).get('/ping');
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'ts']);
  });

  it('ts', async () => {
    const res = await request(app).get('/ping');
    expect(typeof res.body.ts).toBe('string');
  });

  it('禁用字段 ×4 — status alive pong timestamp 均不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('alive');
    expect(res.body).not.toHaveProperty('pong');
    expect(res.body).not.toHaveProperty('timestamp');
  });
});
