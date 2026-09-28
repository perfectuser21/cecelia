/**
 * 迁移 484（决策 28674999）：llm_usage_snapshots 空表删除，analytics 的两个快照接口同 PR 删除。
 * 守卫：这两个路由不得再被注册（否则请求会打到已不存在的表）。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

let app;
beforeAll(async () => {
  const router = (await import('../analytics.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});

describe('analytics 路由：llm_usage_snapshots 快照接口已随表删除', () => {
  it('POST /analytics/compute-snapshot 不再注册（404）', async () => {
    const res = await request(app).post('/api/brain/analytics/compute-snapshot').send({});
    expect(res.status).toBe(404);
  });
  it('GET /analytics/compute-usage 不再注册（404）', async () => {
    const res = await request(app).get('/api/brain/analytics/compute-usage');
    expect(res.status).toBe(404);
  });
});
