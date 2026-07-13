/**
 * TDD Red 测试 — GET /api/brain/harness/ping
 * 这些测试在 generator 实现 /ping 路由之前全部 FAIL（Red 阶段）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /ping [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const routerMod = await import('../routes/harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });

  it('ok 字段为布尔 true', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('ts 字段为 string 类型', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(typeof res.body.ts).toBe('string');
  });

  it('ts 字段符合 ISO 8601 格式', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('keys 完整性 — 只含 ok 和 ts', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['ok', 'ts']);
  });

  it('禁用字段 status 不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('status');
  });

  it('禁用字段 alive 不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('alive');
  });

  it('禁用字段 pong 不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('pong');
  });

  it('禁用字段 timestamp 不存在', async () => {
    const res = await request(app).get('/ping');
    expect(res.body).not.toHaveProperty('timestamp');
  });
});
