import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

const ISO_8601_EXTENDED =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// 按 TDD 纪律，Red 阶段 time.js 还不存在。用 dynamic import 包在每个 it 里，
// 让每个 it 独立失败，而不是整个 suite 一次性挂掉——Reviewer 能看到 8 个红。
async function createAppOrThrow() {
  const mod: { default: express.Router } = await import(
    /* @vite-ignore */ '../../../packages/brain/src/routes/time.js'
  );
  const router = mod.default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/time', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('returns HTTP 200 with application/json content-type', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('response body contains iso, timezone, unix fields all non-empty', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(res.body).toHaveProperty('iso');
    expect(res.body).toHaveProperty('timezone');
    expect(res.body).toHaveProperty('unix');
    expect(res.body.iso).not.toBe('');
    expect(res.body.iso).not.toBeNull();
    expect(res.body.timezone).not.toBe('');
    expect(res.body.timezone).not.toBeNull();
    expect(res.body.unix).not.toBe('');
    expect(res.body.unix).not.toBeNull();
  });

  it('iso is a valid ISO 8601 extended format string parseable by Date', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_8601_EXTENDED);
    const parsed = Date.parse(res.body.iso);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it('timezone is a non-empty string', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix is a positive integer in seconds, not milliseconds and not float', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
    // 秒级判定：当前 unix 秒约 1.7e9；毫秒级会 >= 1e12
    expect(res.body.unix).toBeLessThan(1e12);
    // 合理性：不应比真实当下差 > 60 秒
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(res.body.unix - nowSec)).toBeLessThanOrEqual(60);
  });

  it('iso and unix within a single response represent the same moment within 2 seconds', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
    const unixSec = res.body.unix;
    expect(Math.abs(isoSec - unixSec)).toBeLessThanOrEqual(2);
  });

  it('two consecutive calls both succeed and each response is internally consistent', async () => {
    const app = await createAppOrThrow();
    const res1 = await request(app).get('/api/brain/time');
    const res2 = await request(app).get('/api/brain/time');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    for (const res of [res1, res2]) {
      expect(res.body.iso).toMatch(ISO_8601_EXTENDED);
      expect(Number.isInteger(res.body.unix)).toBe(true);
      expect(res.body.unix).toBeLessThan(1e12);
      const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
      expect(Math.abs(isoSec - res.body.unix)).toBeLessThanOrEqual(2);
    }
    expect(res2.body.unix).toBeGreaterThanOrEqual(res1.body.unix);
  });

  it('does not require any auth header to return 200', async () => {
    const app = await createAppOrThrow();
    // 不带任何 Authorization / Cookie / X-API-Key 等头部也应成功
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('iso');
  });
});
