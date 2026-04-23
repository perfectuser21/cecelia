import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';

// TDD Red：在 Generator 实现前，此 import 会在模块解析阶段失败，
// vitest 会把整个文件标记为 error（等价于所有 it 全红）。
import timeRoutes from '../../../packages/brain/src/routes/time.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  // 与合同 ARTIFACT 对齐：server.js 用 app.use('/api/brain', timeRoutes)
  app.use('/api/brain', timeRoutes);
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('GET /api/brain/time 返回 HTTP 200 且 Content-Type 为 application/json', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toContain('application/json');
  });

  it('响应 body 顶层 key 严格等于 [iso, timezone, unix]', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso 是合法 ISO 8601 字符串且可被 Date 解析', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
    const t = new Date(res.body.iso).getTime();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
    // 形如 2026-04-23T12:34:56.789Z 或带时区偏移
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(res.body.iso)).toBe(true);
  });

  it('timezone 是非空字符串', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix 是正整数秒', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
    // 粗略合理范围：大于 2020-01-01 的秒数（1577836800）
    expect(res.body.unix).toBeGreaterThan(1577836800);
  });

  it('iso 与 unix 指向同一时刻（差值 ≤ 1 秒）', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    const isoSeconds = Math.floor(new Date(res.body.iso).getTime() / 1000);
    expect(Math.abs(isoSeconds - res.body.unix)).toBeLessThanOrEqual(1);
  });

  it('连续两次调用 timezone 完全一致', async () => {
    const app = makeApp();
    const a = await request(app).get('/api/brain/time');
    const b = await request(app).get('/api/brain/time');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.timezone).toBe(b.body.timezone);
  });

  it('连续两次调用 unix 单调不减', async () => {
    const app = makeApp();
    const a = await request(app).get('/api/brain/time');
    const b = await request(app).get('/api/brain/time');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Number.isInteger(a.body.unix)).toBe(true);
    expect(Number.isInteger(b.body.unix)).toBe(true);
    expect(b.body.unix - a.body.unix).toBeGreaterThanOrEqual(0);
  });
});
