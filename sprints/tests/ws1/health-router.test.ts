import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../../../packages/brain/src/routes/health.js';

function makeApp() {
  const app = express();
  app.use('/', healthRouter);
  return app;
}

describe('Workstream 1 — Health Router (mounted at /) [BEHAVIOR]', () => {
  it('GET / returns 200 when mounted on a bare app', async () => {
    const app = makeApp();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('responds with status="ok" string field', async () => {
    const app = makeApp();
    const res = await request(app).get('/');
    expect(typeof res.body.status).toBe('string');
    expect(res.body.status).toBe('ok');
  });

  it('responds with uptime_seconds as a finite non-negative number', async () => {
    const app = makeApp();
    const res = await request(app).get('/');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isFinite(res.body.uptime_seconds)).toBe(true);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('responds with version as a non-empty string', async () => {
    const app = makeApp();
    const res = await request(app).get('/');
    expect(typeof res.body.version).toBe('string');
    expect(res.body.version.length).toBeGreaterThan(0);
  });

  it('does not error when called twice in succession (no internal state mutation)', async () => {
    const app = makeApp();
    const r1 = await request(app).get('/');
    const r2 = await request(app).get('/');
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.status).toBe('ok');
    expect(r2.body.status).toBe('ok');
    expect(r1.body.version).toBe(r2.body.version);
  });
});
