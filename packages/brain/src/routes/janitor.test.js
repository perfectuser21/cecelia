// see packages/brain/src/__tests__/janitor.test.js for full integration test suite
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import router from './janitor.js';

describe('janitor routes', () => {
  it('module loads without error', async () => {
    const mod = await import('./janitor.js');
    expect(typeof mod.default).toBe('function');
  });

  it('未知动作执行与配置返回404且不触碰数据库', async () => {
    const app = express();
    app.use(express.json());
    app.locals.pool = { connect() { throw new Error('unexpected database access'); } };
    app.use(router);
    for (const response of [
      await request(app).post('/jobs/docker-prune/run'),
      await request(app).patch('/jobs/docker-prune/config').send({ enabled: true }),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'JANITOR_UNKNOWN_JOB' });
    }
  });
});
