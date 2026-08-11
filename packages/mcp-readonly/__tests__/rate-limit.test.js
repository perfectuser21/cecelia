import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/rate-limit.js';

describe('createRateLimiter', () => {
  it('超过限额返回 429', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, max: 2 }));
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    await agent.get('/ping').expect(200);
    await agent.get('/ping').expect(200);
    const res = await agent.get('/ping');
    expect(res.status).toBe(429);
  });
});
