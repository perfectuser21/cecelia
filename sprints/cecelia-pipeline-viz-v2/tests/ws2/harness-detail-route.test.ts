import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pool 用于隔离测试
const mockPool = {
  query: vi.fn(),
};

vi.mock('../../../../packages/brain/src/db.js', () => ({ pool: mockPool }));

describe('WS2 — Brain /detail 路由 [BEHAVIOR]', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('路由存在：harness.js 含 /initiative/:id/detail GET handler', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(process.cwd(), 'packages/brain/src/routes/harness.js'), 'utf8');
    expect(src).toContain('/initiative/:id/detail');
  });

  it('返回 HTTP 200 + 六字段 schema（initiative_id/prd_content/contract_content/gan_rounds/step_timing/screenshot_urls）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'test-uuid' }] }) // tasks 查 initiative 存在
      .mockResolvedValueOnce({ rows: [{ prd_content: '# Sprint PRD', contract_content: '## Contract', review_rounds: 2 }] }) // initiative_contracts
      .mockResolvedValueOnce({ rows: [] }) // task_events
      .mockResolvedValueOnce({ rows: [] }); // checkpoint_blobs

    const { default: request } = await import('supertest');
    const { createApp } = await import('../../../../packages/brain/src/server.js');
    const app = createApp({ pool: mockPool });

    const res = await request(app)
      .get('/api/brain/harness/initiative/test-uuid/detail')
      .expect(200);

    expect(res.body).toHaveProperty('initiative_id');
    expect(res.body).toHaveProperty('prd_content');
    expect(res.body).toHaveProperty('contract_content');
    expect(res.body).toHaveProperty('gan_rounds');
    expect(res.body).toHaveProperty('step_timing');
    expect(res.body).toHaveProperty('screenshot_urls');
  });

  it('禁用字段不出现在响应中（steps/timeline/result/data/details/info）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'test-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ prd_content: null, contract_content: null, review_rounds: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { default: request } = await import('supertest');
    const { createApp } = await import('../../../../packages/brain/src/server.js');
    const app = createApp({ pool: mockPool });

    const res = await request(app)
      .get('/api/brain/harness/initiative/test-uuid/detail')
      .expect(200);

    const forbidden = ['steps', 'phases', 'timeline', 'data', 'result', 'details', 'info'];
    for (const key of forbidden) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  it('error path：initiative 不存在 → 404 + error 字段为 string', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // initiative not found

    const { default: request } = await import('supertest');
    const { createApp } = await import('../../../../packages/brain/src/server.js');
    const app = createApp({ pool: mockPool });

    const res = await request(app)
      .get('/api/brain/harness/initiative/00000000-0000-0000-0000-000000000000/detail')
      .expect(404);

    expect(typeof res.body.error).toBe('string');
  });

  it('step_timing 元素含 node/started_at/ended_at/duration_ms 字段', async () => {
    const now = new Date().toISOString();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'test-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ prd_content: null, contract_content: null, review_rounds: null }] })
      .mockResolvedValueOnce({ rows: [
        { payload: { nodeName: 'prep' }, created_at: now },
        { payload: { nodeName: 'plan' }, created_at: now },
      ] })
      .mockResolvedValueOnce({ rows: [] });

    const { default: request } = await import('supertest');
    const { createApp } = await import('../../../../packages/brain/src/server.js');
    const app = createApp({ pool: mockPool });

    const res = await request(app)
      .get('/api/brain/harness/initiative/test-uuid/detail')
      .expect(200);

    expect(Array.isArray(res.body.step_timing)).toBe(true);
    if (res.body.step_timing.length > 0) {
      const item = res.body.step_timing[0];
      expect(item).toHaveProperty('node');
      expect(item).toHaveProperty('started_at');
      expect(item).toHaveProperty('ended_at');
      expect(item).toHaveProperty('duration_ms');
    }
  });
});
