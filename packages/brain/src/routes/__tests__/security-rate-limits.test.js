import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import captureAtomsRouter from '../capture-atoms.js';
import evalRouter from '../eval.js';

describe('database and filesystem route rate limits', () => {
  it.each([['capture atoms', captureAtomsRouter], ['skill eval', evalRouter]])('%s先限流再放行到后续路由', async (_name, router) => {
    const reached = vi.fn();
    const app = express();
    app.use('/limited', router);
    app.use('/limited', (_req, res) => { reached(); res.json({ sentinel: true }); });
    // 未匹配的路径仍需先经过router级限流，避免发任何业务写动作。
    for (let index = 0; index < 300; index++) {
      expect((await request(app).post('/limited/rate-contract-sentinel')).status).toBe(200);
    }
    const blocked = await request(app).post('/limited/rate-contract-sentinel');
    expect(blocked.status).toBe(429);
    expect(reached).toHaveBeenCalledTimes(300);
  });
});
