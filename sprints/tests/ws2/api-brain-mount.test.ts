import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../../../packages/brain/src/routes/health.js';

function makeApp() {
  const app = express();
  app.use('/api/brain/health', healthRouter);
  return app;
}

describe('Workstream 2 — Mounted at /api/brain/health [BEHAVIOR]', () => {
  it('GET /api/brain/health returns 200 with application/json content-type', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/i);
  });

  it('response body is a plain JSON object containing status, uptime_seconds, version', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/health');
    expect(res.body).not.toBeNull();
    expect(Array.isArray(res.body)).toBe(false);
    expect(typeof res.body).toBe('object');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'status')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'uptime_seconds')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'version')).toBe(true);
  });

  it('ignores query string parameters and still returns 200 with status=ok', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/brain/health?foo=bar&baz=1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/brain/health/extra-suffix does not collide with the contract', async () => {
    const app = makeApp();
    const exact = await request(app).get('/api/brain/health');
    const suffix = await request(app).get('/api/brain/health/extra-suffix');
    expect(exact.status).toBe(200);
    expect(exact.body.status).toBe('ok');
    expect([200, 404]).toContain(suffix.status);
    if (suffix.status === 200) {
      expect(typeof suffix.body).toBe('object');
      expect(suffix.body).not.toEqual(exact.body);
    }
  });
});
