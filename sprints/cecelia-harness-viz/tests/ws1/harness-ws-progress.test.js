/**
 * WS1 Contract Test — Brain API ws-progress 路由（Supertest Integration）
 * 验证 GET /api/brain/harness/initiative/:id/ws-progress 端点行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../../packages/brain/src/db.js', () => ({ default: mockPool }));

const { default: harnessRouter } = await import('../../../../packages/brain/src/routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

describe('Brain API — GET /initiative/:id/ws-progress [BEHAVIOR]', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('路由存在（返回 200 + initiative_id + workstreams）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('initiative_id');
    expect(res.body).toHaveProperty('workstreams');
  });

  it('路由返回 initiative_id + workstreams 顶层 keys（schema 完整性）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ws_id: 'ws1', title: 'Test WS', status: 'running', evaluate_verdict: null, pr_url: null, fix_round: 0, container_id: null }],
      });
    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(res.body.initiative_id).toBe(VALID_UUID);
    expect(Array.isArray(res.body.workstreams)).toBe(true);
    expect(res.body.workstreams[0].ws_id).toBe('ws1');
  });

  it('路由查询 checkpoint_blobs 路径（container_id 字段正确透传）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ ws_id: 'ws2', title: 'WS2', status: null, evaluate_verdict: null, pr_url: null, fix_round: 0, container_id: 'container-abc' }],
      });
    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(res.body.workstreams[0].container_id).toBe('container-abc');
  });

  it('路由实现对不存在 initiative 返回 404（error path）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('initiative not found');
  });

  it('路由响应不含禁用字段（禁用字段反向检查）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('steps');
    expect(res.body).not.toHaveProperty('phases');
    expect(res.body).not.toHaveProperty('ws_list');
  });
});
