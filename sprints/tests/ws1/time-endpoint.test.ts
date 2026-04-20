import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// 动态 import：合同 Red 阶段目标路由尚不存在，每个 it() 会独立失败而非整个 suite 挂掉
const TIME_ROUTER_SPEC = '../../../packages/brain/src/routes/time.js';

async function loadApp(): Promise<express.Express> {
  const mod: any = await import(/* @vite-ignore */ TIME_ROUTER_SPEC);
  const router = mod.default ?? mod;
  const app = express();
  app.use('/api/brain/time', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('responds 200 with application/json content-type', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns exactly three keys: iso, timezone, unix', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso field is a parseable ISO-8601 string', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    const parsed = new Date(res.body.iso).getTime();
    expect(Number.isFinite(parsed)).toBe(true);
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('timezone field is a non-empty string', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix field is an integer seconds timestamp', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    // 秒级 Unix 时间戳窗口：2020-01-01 ~ 2100-01-01（拦截误填毫秒级）
    expect(res.body.unix).toBeGreaterThan(1_577_836_800);
    expect(res.body.unix).toBeLessThan(4_102_444_800);
  });

  it('iso and unix timestamps agree within 2 seconds', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/brain/time');
    const isoSeconds = new Date(res.body.iso).getTime() / 1000;
    const drift = Math.abs(isoSeconds - res.body.unix);
    expect(drift).toBeLessThanOrEqual(2);
  });

  it('is idempotent: two sequential calls both return 200 with same shape', async () => {
    const app = await loadApp();
    const a = await request(app).get('/api/brain/time');
    const b = await request(app).get('/api/brain/time');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Object.keys(a.body).sort()).toEqual(['iso', 'timezone', 'unix']);
    expect(Object.keys(b.body).sort()).toEqual(['iso', 'timezone', 'unix']);
    expect(a.body.timezone).toBe(b.body.timezone);
  });
});
