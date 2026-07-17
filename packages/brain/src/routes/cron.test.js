import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../cron/disk-guard.js', () => ({
  runDiskGuard: vi.fn().mockResolvedValue({ used: 84, action: 'warn' }),
  __resetDiskGuardForTest: vi.fn(),
}));

vi.mock('../cron/worktree-reaper.js', () => ({
  runWorktreeReaper: vi.fn().mockResolvedValue({ results: [] }),
}));

async function buildApp() {
  const { default: router } = await import('./cron.js');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /trigger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('缺 job 参数返回 400', async () => {
    const app = await buildApp();
    const res = await request(app).post('/trigger').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/job/);
  });

  it('未知 job 返回 400', async () => {
    const app = await buildApp();
    const res = await request(app).post('/trigger').send({ job: 'unknown-job' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/未知 job/);
  });

  it('disk-guard: 重置节流 + 调用 runDiskGuard + 返回日志', async () => {
    const { __resetDiskGuardForTest, runDiskGuard } = await import('../cron/disk-guard.js');
    const app = await buildApp();
    const res = await request(app).post('/trigger').send({ job: 'disk-guard' });
    expect(res.status).toBe(200);
    expect(__resetDiskGuardForTest).toHaveBeenCalled();
    expect(runDiskGuard).toHaveBeenCalled();
    expect(res.body).toMatchObject({ triggered: true, job: 'disk-guard' });
  });

  it('worktree-reaper: 调用 runWorktreeReaper + 返回结果', async () => {
    const { runWorktreeReaper } = await import('../cron/worktree-reaper.js');
    const app = await buildApp();
    const res = await request(app).post('/trigger').send({ job: 'worktree-reaper' });
    expect(res.status).toBe(200);
    expect(runWorktreeReaper).toHaveBeenCalled();
    expect(res.body).toMatchObject({ triggered: true, job: 'worktree-reaper' });
  });
});
