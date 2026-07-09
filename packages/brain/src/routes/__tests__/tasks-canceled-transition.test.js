/**
 * routes/tasks.js — canceled 状态出口 [BEHAVIOR]
 *
 * allowedTransitions 表里 quarantined/paused 都有出口，canceled 没有条目
 * （undefined → fallback 空数组），卡在这个状态的任务永远无法通过 PATCH API
 * 改写任何状态，是个死锁。补 canceled 条目照抄 quarantined/paused 模式。
 *
 * 注：allowedStatuses 门（本文件同 route 的更早一道校验）只放行
 * ['in_progress', 'completed', 'failed'] 作为请求体里的目标状态值，
 * 'queued'/'cancelled' 即便进了 allowedTransitions 表也会被这道更早的门拦住
 * （quarantined/paused 条目里的 queued/cancelled 同样受此限制，非本次改动引入）。
 * 因此本测试验证 canceled → completed / failed 这两条实际可达的路径。
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
