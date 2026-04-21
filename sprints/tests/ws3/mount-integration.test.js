import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../../../packages/brain/src/routes/time.js';

// WS3 exercises the production mount prefix (/api/brain/time). The matching
// ARTIFACT check in contract-dod-ws3.md independently verifies that server.js
// actually wires the router at this exact path.
const buildApp = () => {
  const app = express();
  app.use('/api/brain/time', timeRouter);
  return app;
};

describe('Workstream 3 — production mount prefix /api/brain/time [BEHAVIOR]', () => {
  it('GET /api/brain/time/iso returns 200 with iso field when mounted at production prefix', async () => {
    const res = await request(buildApp()).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
    expect(Number.isNaN(new Date(res.body.iso).getTime())).toBe(false);
  });

  it('GET /api/brain/time/unix returns 200 with integer unix field when mounted at production prefix', async () => {
    const res = await request(buildApp()).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.unix)).toBe(true);
  });

  it('GET /api/brain/time/timezone?tz=UTC returns 200 with echoed tz when mounted at production prefix', async () => {
    const res = await request(buildApp()).get('/api/brain/time/timezone?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.body.tz).toBe('UTC');
    expect(typeof res.body.formatted).toBe('string');
    expect(res.body.formatted.length).toBeGreaterThan(0);
  });

  it('GET /api/brain/time/timezone (missing tz) returns 400 when mounted at production prefix', async () => {
    const res = await request(buildApp()).get('/api/brain/time/timezone');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('router distinguishes real endpoints from unknown paths (iso=200, unknown=404)', async () => {
    const app = buildApp();
    const known = await request(app).get('/api/brain/time/iso');
    const unknown = await request(app).get('/api/brain/time/does-not-exist');
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(404);
  });
});

describe('Workstream 3 — read-only / no-side-effect contract [BEHAVIOR]', () => {
  it('POST /api/brain/time/iso is rejected but GET /api/brain/time/iso succeeds', async () => {
    const app = buildApp();
    const getRes = await request(app).get('/api/brain/time/iso');
    const postRes = await request(app).post('/api/brain/time/iso');
    expect(getRes.status).toBe(200);
    expect([404, 405]).toContain(postRes.status);
  });

  it('concurrent GETs to all three endpoints all succeed with expected status codes', async () => {
    const app = buildApp();
    const [iso, unix, tz] = await Promise.all([
      request(app).get('/api/brain/time/iso'),
      request(app).get('/api/brain/time/unix'),
      request(app).get('/api/brain/time/timezone?tz=UTC'),
    ]);
    expect(iso.status).toBe(200);
    expect(unix.status).toBe(200);
    expect(tz.status).toBe(200);
  });
});
