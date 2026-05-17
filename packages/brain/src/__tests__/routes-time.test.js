import { describe, test, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('routes/time.js', () => {
  let app;

  beforeEach(async () => {
    const router = (await import('../routes/time.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/brain/time', router);
  });

  test('GET /unix returns 200 with JSON containing integer unix field', async () => {
    const res = await request(app).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('unix');
    expect(Number.isInteger(res.body.unix)).toBe(true);
  });

  test('GET /unix returns a value within 5 seconds of Date.now()/1000', async () => {
    const res = await request(app).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(res.body.unix - nowSec)).toBeLessThan(5);
  });

  test('GET /unix is a non-negative second-level timestamp (not ms)', async () => {
    const res = await request(app).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
    expect(res.body.unix).toBeGreaterThan(1_600_000_000);
    expect(res.body.unix).toBeLessThan(10_000_000_000);
  });
});
