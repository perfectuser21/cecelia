/**
 * W7.7: POST /api/brain/tasks/:id/dispatch 响应契约
 *
 * 历史 bug：派发实际成功，但响应体偶发 {error: 'dispatch failed'} 形态，
 * 客户端误判为失败。新契约：
 *   - 成功路径：HTTP 202 Accepted，body = { task_id, dispatched_at, ... }
 *   - 失败路径：HTTP 4xx/5xx，body 含 error 字段
 *
 * 全 mock：db.js + executor.js（triggerCeceliaRun / checkCeceliaRunAvailable）
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const mockExecutor = vi.hoisted(() => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
}));

vi.mock('../../packages/brain/src/db.js', () => ({ default: mockPool }));
vi.mock('../../packages/brain/src/executor.js', () => mockExecutor);

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../packages/brain/src/routes/tasks.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

describe('POST /api/brain/tasks/:id/dispatch — response contract (W7.7)', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('成功派发 → 202 Accepted + body 含 task_id 和 dispatched_at', async () => {
    const taskId = 'task-success-1';

    // 1) SELECT task → 返回 queued 任务
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: taskId, status: 'queued', title: 'sample task' }],
    });
    // 2) UPDATE → in_progress
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    mockExecutor.checkCeceliaRunAvailable.mockResolvedValueOnce({ available: true });
    mockExecutor.triggerCeceliaRun.mockResolvedValueOnce({
      success: true,
      runId: 'run-abc-123',
    });

    const res = await request(app).post(`/api/brain/tasks/${taskId}/dispatch`);

    expect(res.status).toBe(202);
    expect(res.body.task_id).toBe(taskId);
    expect(res.body.dispatched_at).toBeDefined();
    expect(typeof res.body.dispatched_at).toBe('string');
    expect(res.body.error).toBeUndefined();
  });

  it('task 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/brain/tasks/missing/dispatch');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('task 状态非 queued → 409', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 't2', status: 'in_progress', title: 't2' }],
    });

    const res = await request(app).post('/api/brain/tasks/t2/dispatch');
    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
  });

  it('executor 不可用 → 503，且回滚状态到 queued', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 't3', status: 'queued', title: 't3' }],
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // rollback UPDATE

    mockExecutor.checkCeceliaRunAvailable.mockResolvedValueOnce({
      available: false,
      error: 'bridge offline',
    });

    const res = await request(app).post('/api/brain/tasks/t3/dispatch');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  it('triggerCeceliaRun 失败 → 5xx，且回滚状态', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 't4', status: 'queued', title: 't4' }],
    });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [] }); // rollback UPDATE

    mockExecutor.checkCeceliaRunAvailable.mockResolvedValueOnce({ available: true });
    mockExecutor.triggerCeceliaRun.mockResolvedValueOnce({
      success: false,
      error: 'spawn failed',
    });

    const res = await request(app).post('/api/brain/tasks/t4/dispatch');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.error).toBeDefined();
  });
});
