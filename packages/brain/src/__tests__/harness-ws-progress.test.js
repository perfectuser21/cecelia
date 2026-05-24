/**
 * harness-ws-progress.test.js — WS2 单元测试（mock pool）
 * 覆盖 GET /initiative/:id/ws-progress 路由逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

const { default: harnessRouter } = await import('../routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

describe('GET /harness/initiative/:id/ws-progress', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('initiative_id 和 workstreams 字段正确（schema 完整性）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ws_id: 'ws1',
            title: 'Test WS',
            status: 'running',
            evaluate_verdict: null,
            pr_url: null,
            fix_round: 0,
            container_id: null,
          },
        ],
      });

    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body.initiative_id).toBe(VALID_UUID);
    expect(Array.isArray(res.body.workstreams)).toBe(true);
    expect(res.body.workstreams).toHaveLength(1);
    expect(res.body.workstreams[0].ws_id).toBe('ws1');
    expect(typeof res.body.workstreams[0].fix_round).toBe('number');
  });

  it('mock pool 无 initiative 时返回 404 not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('initiative not found');
  });

  it('空数组：无子任务时 workstreams 返回 []', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body.workstreams).toEqual([]);
  });

  it('fix_round 是 number 类型（字段类型校验）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ws_id: 'ws2',
            title: 'Fix WS',
            status: 'merged',
            evaluate_verdict: 'PASS',
            pr_url: 'https://github.com/test/pr/1',
            fix_round: 2,
            container_id: null,
          },
        ],
      });

    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);

    expect(res.status).toBe(200);
    expect(typeof res.body.workstreams[0].fix_round).toBe('number');
    expect(res.body.workstreams[0].fix_round).toBe(2);
  });

  it('响应不含禁用字段（fields 反向检查）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: VALID_UUID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ws_id: 'ws3',
            title: 'WS3',
            status: null,
            evaluate_verdict: null,
            pr_url: null,
            fix_round: 0,
            container_id: 'container-abc',
          },
        ],
      });

    const res = await request(app).get(`/harness/initiative/${VALID_UUID}/ws-progress`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('steps');
    expect(res.body).not.toHaveProperty('phases');
    expect(res.body).not.toHaveProperty('ws_list');
    expect(res.body.workstreams[0]).not.toHaveProperty('steps');
    expect(res.body.workstreams[0]).not.toHaveProperty('phases');
    expect(res.body.workstreams[0]).not.toHaveProperty('ws_list');
  });
});
