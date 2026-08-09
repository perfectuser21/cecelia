import { describe, it, expect, vi, beforeEach } from 'vitest';

// db 是本只读 API 的外层边界（非本单被改的写边）→ 允许 mock 以单测聚合 shape 与 days 校验
const mockQuery = vi.fn();
vi.mock('../../../packages/brain/src/db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  // TDD Red: /failure-stats 路由尚未注册 → 请求得 404 = 真红
  const { default: router } = await import('../../../packages/brain/src/routes/harness.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/harness', router);
  return app;
}
const req = async () => (await import('supertest')).default;

describe('failure-stats route [BEHAVIOR]', () => {
  beforeEach(() => mockQuery.mockReset());

  it('GET failure-stats 返回 failure_rate 与 by_class', async () => {
    // 构造：3 terminal（2 failed / 1 blocked），by_class 两类
    mockQuery.mockResolvedValue({
      rows: [
        { failure_class: 'invalid_gear', status: 'failed', n: '2' },
        { failure_class: 'dispatch_exception', status: 'blocked', n: '1' },
      ],
    });
    const res = await (await req())(await makeApp()).get('/api/brain/harness/failure-stats?days=7');
    expect(res.status).toBe(200);
    expect(typeof res.body.failure_rate).toBe('number');
    expect(typeof res.body.by_class).toBe('object');
    expect(res.body).toHaveProperty('total_terminal');
    expect(res.body).toHaveProperty('total_failed');
  });

  it('days=0 返回 400', async () => {
    const res = await (await req())(await makeApp()).get('/api/brain/harness/failure-stats?days=0');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });
});
