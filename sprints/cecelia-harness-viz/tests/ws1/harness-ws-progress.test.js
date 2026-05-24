import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock db.js before importing router (vi.mock is hoisted automatically)
const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../../packages/brain/src/db.js', () => ({ default: mockPool }));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../../../packages/brain/src/routes/harness.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('Brain API — GET /initiative/:id/ws-progress [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('schema 完整性: 返回顶层 keys 精确等于 ["initiative_id","workstreams"]', async () => {
    const testId = '11111111-1111-1111-1111-111111111111';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: testId }] })  // initiative exists
      .mockResolvedValueOnce({ rows: [] });                // no checkpoints

    const app = createApp();
    const res = await request(app).get(`/initiative/${testId}/ws-progress`);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['initiative_id', 'workstreams']);
  });

  it('initiative_id 字段值等于请求路径中的 id', async () => {
    const testId = '22222222-2222-2222-2222-222222222222';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: testId }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get(`/initiative/${testId}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body.initiative_id).toBe(testId);
  });

  it('空数组边界: 无 WS checkpoint 的 initiative 返回 workstreams=[]', async () => {
    const testId = '33333333-3333-3333-3333-333333333333';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: testId }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get(`/initiative/${testId}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toEqual([]);
  });

  it('404 error path: 不存在 initiative_id 返回 HTTP 404 + error 字段', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get('/initiative/00000000-0000-0000-0000-000000000000/ws-progress');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('initiative not found');
  });

  it('子字段 schema: workstream 子对象含 ws_id/title/status/evaluate_verdict/pr_url/fix_round/container_id', async () => {
    const testId = '44444444-4444-4444-4444-444444444444';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: testId }] })
      .mockResolvedValueOnce({ rows: [{ thread_id: `harness-task:${testId}:ws1` }] })
      .mockResolvedValueOnce({ rows: [] })  // blob rows
      .mockResolvedValueOnce({ rows: [] }); // thread_lookup fallback

    const app = createApp();
    const res = await request(app).get(`/initiative/${testId}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toHaveLength(1);
    const ws = res.body.workstreams[0];
    expect(ws).toHaveProperty('ws_id');
    expect(ws).toHaveProperty('title');
    expect(ws).toHaveProperty('status');
    expect(ws).toHaveProperty('evaluate_verdict');
    expect(ws).toHaveProperty('pr_url');
    expect(ws).toHaveProperty('fix_round');
    expect(ws).toHaveProperty('container_id');
  });

  it('fix_round 字段类型: workstream 子对象 fix_round 是 number 类型', async () => {
    const testId = '55555555-5555-5555-5555-555555555555';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: testId }] })
      .mockResolvedValueOnce({ rows: [{ thread_id: `harness-task:${testId}:ws1` }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = createApp();
    const res = await request(app).get(`/initiative/${testId}/ws-progress`);

    expect(res.status).toBe(200);
    expect(typeof res.body.workstreams[0].fix_round).toBe('number');
  });
});
