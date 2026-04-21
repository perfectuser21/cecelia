import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../../../packages/brain/src/routes/time.js';

const buildApp = () => {
  const app = express();
  app.use('/', timeRouter);
  return app;
};

describe('Workstream 2 — /timezone happy path [BEHAVIOR]', () => {
  it('GET /timezone?tz=Asia/Shanghai returns 200 with JSON, echoed tz and non-empty formatted', async () => {
    const res = await request(buildApp()).get('/timezone?tz=Asia/Shanghai');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.tz).toBe('Asia/Shanghai');
    expect(typeof res.body.formatted).toBe('string');
    expect(res.body.formatted.length).toBeGreaterThan(0);
  });

  it('GET /timezone?tz=UTC returns 200 with JSON and echoed tz=UTC', async () => {
    const res = await request(buildApp()).get('/timezone?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.tz).toBe('UTC');
    expect(typeof res.body.formatted).toBe('string');
    expect(res.body.formatted.length).toBeGreaterThan(0);
  });

  it('GET /timezone?tz=America/Los_Angeles and ?tz=Asia/Shanghai yield distinct formatted values', async () => {
    const la = await request(buildApp()).get('/timezone?tz=America/Los_Angeles');
    const sh = await request(buildApp()).get('/timezone?tz=Asia/Shanghai');
    expect(la.status).toBe(200);
    expect(sh.status).toBe(200);
    expect(la.headers['content-type']).toMatch(/application\/json/);
    expect(sh.headers['content-type']).toMatch(/application\/json/);
    expect(la.body.formatted).not.toBe(sh.body.formatted);
  });
});

describe('Workstream 2 — /timezone error handling [BEHAVIOR]', () => {
  it('GET /timezone?tz=Not/AReal_Zone returns 400 with JSON error and non-empty error string', async () => {
    const res = await request(buildApp()).get('/timezone?tz=Not/AReal_Zone');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GET /timezone without tz param returns 400 with JSON error and non-empty error string', async () => {
    const res = await request(buildApp()).get('/timezone');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GET /timezone?tz= (empty string) returns 400 with JSON error and non-empty error string', async () => {
    const res = await request(buildApp()).get('/timezone?tz=');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GET /timezone?tz=<sql-injection-like-garbage> returns 400 not 500 with JSON error', async () => {
    const res = await request(buildApp()).get("/timezone?tz=%27%20OR%201%3D1--");
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});
