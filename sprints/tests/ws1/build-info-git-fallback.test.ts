import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => {
    throw new Error('git: command not found');
  }),
  default: {
    execSync: vi.fn(() => {
      throw new Error('git: command not found');
    }),
  },
}));

async function makeApp(): Promise<express.Express> {
  const mod = await import('../../../packages/brain/src/routes/build-info.js');
  const router = (mod as { default: express.Router }).default;
  const app = express();
  app.use('/api/brain/build-info', router);
  return app;
}

describe('Workstream 1 — git fallback [BEHAVIOR]', () => {
  it('returns 200 and git_sha="unknown" when git execSync throws', async () => {
    const app = await makeApp();
    const res = await request(app).get('/api/brain/build-info');
    expect(res.status).toBe(200);
    expect(res.body.git_sha).toBe('unknown');
  });
});
