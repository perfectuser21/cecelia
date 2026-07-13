/**
 * routes/tasks.js — canceled 状态出口 [BEHAVIOR]
 *
 * allowedTransitions 表里 quarantined/paused 都有出口，canceled 没有条目
 * （undefined → fallback 空数组），卡在这个状态的任务永远无法通过 PATCH API
 * 改写任何状态，是个死锁。补 canceled 条目照抄 quarantined/paused 模式。
 *
 * 本路由是 server.js 实际挂载到 /api/brain 的任务 PATCH API。
 * 合同要求 PATCH {"status":"cancelled"} 可取消 headless smoke 创建的任务，
 * 因此取消态必须同时通过早期 allowedStatuses 门与状态流转表。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('PATCH /api/brain/tasks/:task_id — canceled 状态出口 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('canceled → completed 应返回 200（此前因缺 canceled 出口条目返回 409 死锁）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-canceled-1', status: 'canceled' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'task-canceled-1', status: 'completed' }] }); // UPDATE

    const res = await request(app)
      .patch('/api/brain/tasks/task-canceled-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });

  it('canceled → failed 应返回 200', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-canceled-2', status: 'canceled' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-canceled-2', status: 'failed' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-canceled-2')
      .send({ status: 'failed' });

    expect(res.status).toBe(200);
  });

  it('pending_postdeploy → cancelled 应返回 200 并回传 cancelled', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-headless-1', status: 'pending_postdeploy' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-headless-1', status: 'cancelled', updated_at: '2026-07-13T00:00:00Z' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-headless-1')
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('task-headless-1');
    expect(res.body.status).toBe('cancelled');
  });

  it('queued → cancelled 应返回 200 并清理 claim 字段', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-headless-2', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-headless-2', status: 'cancelled', updated_at: '2026-07-13T00:00:00Z' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-headless-2')
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE tasks SET')
    );
    expect(updateCall[0]).toMatch(/claimed_by = NULL/);
    expect(updateCall[0]).toMatch(/claimed_at = NULL/);
  });

  it('回归哨兵：quarantined → completed 仍然通过（不因本次改动破坏既有出口）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-q-1', status: 'quarantined' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-q-1', status: 'completed' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-q-1')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
  });
});
