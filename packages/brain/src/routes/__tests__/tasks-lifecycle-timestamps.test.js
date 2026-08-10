import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn().mockResolvedValue({ success: true }),
}));

function currentTask(status) {
  return {
    id: 'task-lifecycle-time',
    status,
    claimed_by: null,
    executor_kind: 'headed-session',
    task_type: 'dev',
    orchestrator: null,
    review_required_raw: 'false',
    review_status: 'approved',
    pr_url: null,
    pr_merged_at: null,
  };
}

describe('PATCH /api/brain/tasks/:task_id 生命周期时间戳 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('queued → in_progress 必须持久化 started_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentTask('queued')] })
      .mockResolvedValueOnce({
        rows: [{
          status: 'in_progress',
          updated_at: '2026-08-10T02:00:00.000Z',
          started_at: '2026-08-10T02:00:00.000Z',
          completed_at: null,
        }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-lifecycle-time')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toContain('started_at = COALESCE(started_at, NOW())');
    expect(res.body.started_at).toBe('2026-08-10T02:00:00.000Z');
  });

  it('in_progress → completed 必须持久化 completed_at', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentTask('in_progress')] })
      .mockResolvedValueOnce({
        rows: [{
          status: 'completed',
          updated_at: '2026-08-10T02:01:00.000Z',
          started_at: '2026-08-10T02:00:00.000Z',
          completed_at: '2026-08-10T02:01:00.000Z',
        }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-lifecycle-time')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toContain('completed_at = COALESCE(completed_at, NOW())');
    expect(res.body.completed_at).toBe('2026-08-10T02:01:00.000Z');
  });

  it('completed 幂等回写必须修复历史空时间戳', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentTask('completed')] })
      .mockResolvedValueOnce({
        rows: [{
          status: 'completed',
          updated_at: '2026-08-10T02:02:00.000Z',
          started_at: '2026-08-10T02:02:00.000Z',
          completed_at: '2026-08-10T02:02:00.000Z',
        }],
      });

    const res = await request(app)
      .patch('/api/brain/tasks/task-lifecycle-time')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toContain('started_at = COALESCE(started_at, completed_at, NOW())');
    expect(mockQuery.mock.calls[1][0]).toContain('completed_at = COALESCE(completed_at, NOW())');
    expect(res.body.started_at).toBe('2026-08-10T02:02:00.000Z');
    expect(res.body.completed_at).toBe('2026-08-10T02:02:00.000Z');
  });
});
