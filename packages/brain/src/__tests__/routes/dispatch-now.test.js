/**
 * Route tests: POST /api/brain/dispatch-now
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockTriggerCeceliaRun = vi.hoisted(() => vi.fn());
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: mockTriggerCeceliaRun,
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
}));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/execution.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('POST /dispatch-now', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('缺少 task_id 时返回 400', async () => {
    const res = await request(app).post('/dispatch-now').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('task_id');
  });

  it('task 不存在时返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/dispatch-now').send({ task_id: 'nonexistent' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('task 已 in_progress 时返回 409', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'in_progress' }] });

    const res = await request(app).post('/dispatch-now').send({ task_id: 't1' });
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('in_progress');
  });

  it('task 已 completed 时返回 409', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 't1', status: 'completed' }] });

    const res = await request(app).post('/dispatch-now').send({ task_id: 't1' });
    expect(res.status).toBe(409);
  });

  it('成功时标记 in_progress 并返回 { success, runId, taskId }', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'queued', task_type: 'dev' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE in_progress

    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, runId: 'run-abc', taskId: 't1' });

    const res = await request(app).post('/dispatch-now').send({ task_id: 't1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.runId).toBe('run-abc');
    expect(res.body.taskId).toBe('t1');
  });

  it('triggerCeceliaRun 失败时回滚状态并返回 500', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'queued', task_type: 'dev' }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE in_progress
      .mockResolvedValueOnce({ rows: [] }); // UPDATE queued (rollback)

    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: false, reason: 'resource_exhausted' });

    const res = await request(app).post('/dispatch-now').send({ task_id: 't1' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('resource_exhausted');
  });

  it('triggerCeceliaRun 调用时传入 in_progress 状态的 task', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't2', status: 'queued', task_type: 'dev' }] })
      .mockResolvedValueOnce({ rows: [] });

    mockTriggerCeceliaRun.mockResolvedValueOnce({ success: true, runId: 'run-xyz', taskId: 't2' });

    await request(app).post('/dispatch-now').send({ task_id: 't2' });

    const calledTask = mockTriggerCeceliaRun.mock.calls[0][0];
    expect(calledTask.status).toBe('in_progress');
  });
});
