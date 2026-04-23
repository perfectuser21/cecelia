import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
// @ts-expect-error — module does not exist yet (TDD Red phase); will be created by Generator
import timeRouter from '../../../packages/brain/src/routes/time.js';

function makeApp() {
  const app = express();
  app.use('/api/brain', timeRouter as any);
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/brain/time responds with HTTP 200 and application/json content type', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('response body contains exactly the three keys iso, timezone, unix — no others', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso is a string parseable as a Date within 2 seconds of request time', async () => {
    const before = Date.now();
    const res = await request(makeApp()).get('/api/brain/time');
    const after = Date.now();
    expect(typeof res.body.iso).toBe('string');
    const parsedMs = new Date(res.body.iso).getTime();
    expect(Number.isFinite(parsedMs)).toBe(true);
    expect(parsedMs).toBeGreaterThanOrEqual(before - 2000);
    expect(parsedMs).toBeLessThanOrEqual(after + 2000);
  });

  it('unix is a positive integer in seconds (at most 10 digits), not milliseconds', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
    expect(String(res.body.unix).length).toBeLessThanOrEqual(10);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(res.body.unix - nowSec)).toBeLessThanOrEqual(2);
  });

  it('timezone is a non-empty string', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('new Date(iso).getTime() and unix * 1000 agree within 2000ms', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    const isoMs = new Date(res.body.iso).getTime();
    const unixMs = res.body.unix * 1000;
    expect(Math.abs(isoMs - unixMs)).toBeLessThanOrEqual(2000);
  });

  it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)', async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .get('/api/brain/time')
      .query({ iso: 'evil', unix: '1', timezone: 'Fake/Zone' });
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.body.iso).not.toBe('evil');
    expect(res.body.unix).not.toBe(1);
    expect(res.body.timezone).not.toBe('Fake/Zone');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    const isoMs = new Date(res.body.iso).getTime();
    expect(isoMs).toBeGreaterThanOrEqual(before - 2000);
    expect(isoMs).toBeLessThanOrEqual(after + 2000);
  });

  it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined', async () => {
    // 模拟 Intl.DateTimeFormat().resolvedOptions().timeZone 返回空字符串的容器/运行时环境
    const spy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () =>
          ({
            resolvedOptions: () => ({ timeZone: '' as unknown as string }) as Intl.ResolvedDateTimeFormatOptions,
          }) as unknown as Intl.DateTimeFormat,
      );
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('UTC');
    spy.mockRestore();
  });
});
