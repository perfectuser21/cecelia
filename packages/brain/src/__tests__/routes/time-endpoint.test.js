import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../../routes/time.js';

const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function buildApp() {
  const app = express();
  app.use('/api/time', timeRouter);
  return app;
}

describe('Workstream 2 — GET /api/time endpoint [BEHAVIOR]', () => {
  it('GET /api/time returns 200 with iso, timezone, unix fields', async () => {
    const res = await request(buildApp()).get('/api/time');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
    expect(typeof res.body.timezone).toBe('string');
    expect(typeof res.body.unix).toBe('number');
  });

  it('iso field matches ISO-8601 with offset', async () => {
    const res = await request(buildApp()).get('/api/time');
    expect(res.status).toBe(200);
    expect(res.body.iso).toMatch(ISO_WITH_OFFSET);
  });

  it('unix field is an integer', async () => {
    const res = await request(buildApp()).get('/api/time');
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.unix)).toBe(true);
  });

  it('iso parses back to within 2 seconds of unix', async () => {
    const res = await request(buildApp()).get('/api/time');
    expect(res.status).toBe(200);
    const isoSec = Math.floor(new Date(res.body.iso).getTime() / 1000);
    expect(Math.abs(isoSec - res.body.unix)).toBeLessThanOrEqual(2);
  });

  it('GET /api/time?tz=Asia/Shanghai echoes timezone and uses +08:00 offset', async () => {
    const res = await request(buildApp()).get('/api/time').query({ tz: 'Asia/Shanghai' });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Asia/Shanghai');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.endsWith('+08:00')).toBe(true);
  });

  it('GET /api/time?tz=UTC echoes timezone with zero offset', async () => {
    const res = await request(buildApp()).get('/api/time').query({ tz: 'UTC' });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('UTC');
    expect(/(\+00:00|Z)$/.test(res.body.iso)).toBe(true);
  });

  it('GET /api/time?tz=Foo/Bar returns 400 with error message mentioning tz', async () => {
    const res = await request(buildApp()).get('/api/time').query({ tz: 'Foo/Bar' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(/tz|timezone/i.test(res.body.error)).toBe(true);
  });

  it('GET /api/time?tz= (empty string) falls back to default and returns 200', async () => {
    const res = await request(buildApp()).get('/api/time?tz=');
    expect(res.status).toBe(200);
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('two adjacent requests return unix within 1 second of each other', async () => {
    const app = buildApp();
    const r1 = await request(app).get('/api/time');
    const r2 = await request(app).get('/api/time');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(Math.abs(r2.body.unix - r1.body.unix)).toBeLessThanOrEqual(1);
    expect(r2.body.timezone).toBe(r1.body.timezone);
  });
});
