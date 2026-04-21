import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// 懒加载：让 import 失败在每个 it 内单独报红（TDD Red 阶段实现还不存在）
let app;
async function getApp() {
  if (app) return app;
  const mod = await import('../../../packages/brain/src/routes/time.js');
  const timeRoutes = mod.default;
  const a = express();
  a.use(express.json());
  a.use('/api/brain/time', timeRoutes);
  app = a;
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('responds with HTTP 200 and application/json on GET /api/brain/time', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('response body has exactly three keys: iso, timezone, unix', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso is an ISO-8601 UTC millisecond string', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('timezone is a non-empty string', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix is an integer within 1 second of current wall clock', async () => {
    const a = await getApp();
    const before = Math.floor(Date.now() / 1000);
    const res = await request(a).get('/api/brain/time');
    const after = Math.floor(Date.now() / 1000);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThanOrEqual(before - 1);
    expect(res.body.unix).toBeLessThanOrEqual(after + 1);
  });

  it('iso and unix represent the same moment within 1 second tolerance', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    const isoSeconds = Math.floor(new Date(res.body.iso).getTime() / 1000);
    expect(Number.isNaN(isoSeconds)).toBe(false);
    expect(Math.abs(isoSeconds - res.body.unix)).toBeLessThanOrEqual(1);
  });

  it('two consecutive calls spaced 1.1 seconds return different unix values', async () => {
    const a = await getApp();
    const r1 = await request(a).get('/api/brain/time');
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await request(a).get('/api/brain/time');
    expect(r2.body.unix).toBeGreaterThan(r1.body.unix);
  });
});
