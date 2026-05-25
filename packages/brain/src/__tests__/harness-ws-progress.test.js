/**
 * harness-ws-progress.test.js
 * 验证 routes/harness.js 中 GET /initiative/:id/ws-progress 端点
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool, pool: mockPool }));

const { default: harnessRouter } = await import('../routes/harness.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/harness', harnessRouter);
  return app;
}

const INIT_ID = '12345678-1234-1234-1234-123456789abc';

describe('GET /harness/initiative/:id/ws-progress', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('HTTP 200 + initiative_id(string) + workstreams(array)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(typeof res.body.initiative_id).toBe('string');
    expect(Array.isArray(res.body.workstreams)).toBe(true);
  });

  it('empty workstreams — workstreams []（空数组边界场景）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/ws-progress`);
    expect(res.status).toBe(200);
    expect(res.body.workstreams).toEqual([]);
  });

  it('workstreams 条目含 fix_round（number 类型）', async () => {
    const thread_id = `harness-task:${INIT_ID}:ws1`;
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [{ thread_id }] })
      .mockResolvedValueOnce({
        rows: [
          { channel: 'fix_round', type: 'json', blob: Buffer.from(JSON.stringify(2)) },
          { channel: 'status', type: 'json', blob: Buffer.from(JSON.stringify('completed')) },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/ws-progress`);
    expect(res.status).toBe(200);
    const ws = res.body.workstreams[0];
    expect(typeof ws.fix_round === 'number').toBe(true);
  });

  it('404 + error string（initiative 不存在）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/ws-progress`);
    expect(res.status).toBe(404);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error).toContain('initiative not found');
  });

  it('workstream 条目含 ws_id / title / status / evaluate_verdict / pr_url / container_id', async () => {
    const thread_id = `harness-task:${INIT_ID}:ws2`;
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: INIT_ID }] })
      .mockResolvedValueOnce({ rows: [{ thread_id }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(`/harness/initiative/${INIT_ID}/ws-progress`);
    expect(res.status).toBe(200);
    const ws = res.body.workstreams[0];
    expect(ws).toHaveProperty('ws_id');
    expect(ws).toHaveProperty('title');
    expect(ws).toHaveProperty('status');
    expect(ws).toHaveProperty('evaluate_verdict');
    expect(ws).toHaveProperty('pr_url');
    expect(ws).toHaveProperty('container_id');
  });
});
