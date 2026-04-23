/**
 * GET /api/brain/time/timezone —— 时区查询端点的端到端测试
 *
 * Task: 1776e04e (新增 /api/brain/time/timezone 端点，支持 tz 参数)
 *
 * BEHAVIOR DoD:
 *  - 无参调用返回 HTTP 200 + timezone == 'Asia/Shanghai'
 *  - 带合法 tz（如 America/New_York）返回 HTTP 200 + timezone 原样回显
 *  - 带非法 tz（如 Not/AReal_Zone）返回 HTTP 400 + JSON 含可读 error 字段
 *  - ws1 端点（/iso）行为保持不变
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

describe('GET /api/brain/time/timezone', () => {
  it('no query params: returns HTTP 200 with timezone == Asia/Shanghai', async () => {
    const res = await request(app).get('/api/brain/time/timezone');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toBeTypeOf('object');
    expect(res.body.timezone).toBe('Asia/Shanghai');
    expect(typeof res.body.time).toBe('string');
    expect(res.body.time.length).toBeGreaterThan(0);
  });

  it('with valid tz=America/New_York: returns HTTP 200 with echoed timezone', async () => {
    const res = await request(app)
      .get('/api/brain/time/timezone')
      .query({ tz: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.timezone).toBe('America/New_York');
    expect(typeof res.body.time).toBe('string');
    expect(res.body.time.length).toBeGreaterThan(0);
  });

  it('with valid tz=UTC: returns HTTP 200 with echoed timezone', async () => {
    const res = await request(app)
      .get('/api/brain/time/timezone')
      .query({ tz: 'UTC' });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('UTC');
    expect(typeof res.body.time).toBe('string');
  });

  it('with invalid tz=Not/AReal_Zone: returns HTTP 400 with readable error field', async () => {
    const res = await request(app)
      .get('/api/brain/time/timezone')
      .query({ tz: 'Not/AReal_Zone' });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toBeTypeOf('object');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('with invalid tz=complete_garbage_value: returns HTTP 400 (not 500)', async () => {
    const res = await request(app)
      .get('/api/brain/time/timezone')
      .query({ tz: 'complete_garbage_value' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});

describe('Regression: ws1 /iso endpoint unchanged', () => {
  it('GET /api/brain/time/iso still returns 200 with iso field', async () => {
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/);
  });
});
