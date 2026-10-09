/**
 * 回归测试：GET /api/brain/tasks（status.js，生产实际命中的处理器）
 * 非法 status / limit 必须 400 且不查库；库错误不得透出 details。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockGetTopTasks = vi.hoisted(() => vi.fn());

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../focus.js', () => ({
  getDailyFocus: vi.fn(), setDailyFocus: vi.fn(), clearDailyFocus: vi.fn(), getFocusSummary: vi.fn(),
}));
vi.mock('../../tick.js', () => ({ getTickStatus: vi.fn(), TASK_TYPE_AGENT_MAP: {} }));
vi.mock('../../routes/shared.js', () => ({
  getActivePolicy: vi.fn(), getWorkingMemory: vi.fn(), getTopTasks: mockGetTopTasks,
  getRecentDecisions: vi.fn(), IDEMPOTENCY_TTL: 0, ALLOWED_ACTIONS: [],
}));
vi.mock('../../nightly-orchestrator.js', () => ({ getNightlyOrchestratorStatus: vi.fn() }));
vi.mock('../../websocket.js', () => ({ default: {}, WS_EVENTS: {} }));

let app;

beforeAll(async () => {
  vi.resetModules();
  const { default: statusRouter } = await import('../../routes/status.js');
  app = express();
  app.use('/api/brain', statusRouter);
});

describe('GET /api/brain/tasks 查询参数校验', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
    mockGetTopTasks.mockReset();
  });

  it('status=bogus → 400 且不查库', async () => {
    const res = await request(app).get('/api/brain/tasks?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
    expect(res.body.allowed).toContain('queued');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it.each(['limit=abc', 'limit=-1', 'status=queued&limit=99999999999999999999'])(
    '%s → 400 invalid_limit 且不查库',
    async (qs) => {
      const res = await request(app).get(`/api/brain/tasks?${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_limit');
      expect(res.body).not.toHaveProperty('details');
      expect(mockPool.query).not.toHaveBeenCalled();
      expect(mockGetTopTasks).not.toHaveBeenCalled();
    },
  );

  it('status=queued&limit=5 → 200，SQL 参数为 [queued, 5]', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'queued' }] });
    const res = await request(app).get('/api/brain/tasks?status=queued&limit=5');
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['queued', 5]);
  });

  it('无参数 → 200 数组，getTopTasks(100)', async () => {
    mockGetTopTasks.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await request(app).get('/api/brain/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockGetTopTasks).toHaveBeenCalledWith(100);
  });

  it('库报错 → 500 且响应体无 details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPool.query.mockRejectedValueOnce(new Error('LIMIT must not be negative'));
    const res = await request(app).get('/api/brain/tasks?status=queued');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to get tasks' });
    expect(res.body).not.toHaveProperty('details');
  });
});
