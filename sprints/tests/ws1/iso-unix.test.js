import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../../../packages/brain/src/routes/time.js';

const buildApp = () => {
  const app = express();
  app.use('/', timeRouter);
  return app;
};

describe('Workstream 1 — /iso endpoint [BEHAVIOR]', () => {
  it('GET /iso returns 200 with JSON containing an iso string field', async () => {
    const res = await request(buildApp()).get('/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.length).toBeGreaterThan(0);
  });

  it('GET /iso iso field is a round-trippable ISO-8601 timestamp with UTC Z suffix', async () => {
    const res = await request(buildApp()).get('/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // Must be UTC Z form with milliseconds (the toISOString() shape),
    // not +08:00 / -07:00 offset forms which would fail the round-trip equality below.
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = new Date(res.body.iso);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(res.body.iso);
  });

  it('GET /iso returns a fresh timestamp within 1 second of wall clock', async () => {
    const before = Date.now();
    const res = await request(buildApp()).get('/iso');
    const after = Date.now();
    expect(res.status).toBe(200);
    const t = new Date(res.body.iso).getTime();
    // Hard threshold ≤ 1 second — window is [before-1000ms, after+1000ms]
    // to absorb network / event-loop jitter while still rejecting any 5s-scale drift.
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(after + 1000);
  });
});

describe('Workstream 1 — /unix endpoint [BEHAVIOR]', () => {
  it('GET /unix returns 200 with JSON and an integer unix field', async () => {
    const res = await request(buildApp()).get('/unix');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
  });

  it('GET /unix unix is a second-granularity timestamp (not milliseconds)', async () => {
    const res = await request(buildApp()).get('/unix');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(res.body.unix).toBeGreaterThanOrEqual(nowSec - 5);
    expect(res.body.unix).toBeLessThanOrEqual(nowSec + 5);
    // Seconds for any plausible 21st/22nd century timestamp are < 1e11;
    // milliseconds are already > 1e12. A value ≥ 1e11 would prove ms granularity.
    expect(res.body.unix).toBeLessThan(1e11);
  });
});
