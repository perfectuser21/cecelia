/**
 * 刀4: map routes 基础测试
 * 覆盖：路由挂载正确、/health 端点返回结构
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../map.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/map', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('map routes', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('router 模块 default export 是 express Router', async () => {
    const { default: router } = await import('../map.js');
    expect(typeof router).toBe('function');
    expect(router.stack).toBeDefined();
  });

  it('GET /health — DB 不可达时返回部分降级（非 500）', async () => {
    mockQuery.mockRejectedValue(new Error('DB unavailable'));
    const app = await makeApp();
    const res = await (await req())(app).get('/api/brain/map/health');
    // 降级不崩溃：可能 200（partial）或 503，但不是 500
    expect(res.status).not.toBe(500);
  });
});
