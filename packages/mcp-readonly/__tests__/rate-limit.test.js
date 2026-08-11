import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter, rateLimitKeyGenerator } from '../src/rate-limit.js';

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

  it('分桶 key 是 token 的 sha256 hash，不是明文', () => {
    const req = { headers: { authorization: 'Bearer supersecrettoken123' }, ip: '1.2.3.4' };
    const key = rateLimitKeyGenerator(req);

    expect(key).not.toContain('supersecrettoken123');
    expect(key).not.toContain('Bearer');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('无 Authorization 时用 IPv6 安全的 fallback，不直接暴露原始 IP', () => {
    const req = { headers: {}, ip: '2001:db8::1' };
    const key = rateLimitKeyGenerator(req);

    expect(key).not.toBe('2001:db8::1');
  });
});
