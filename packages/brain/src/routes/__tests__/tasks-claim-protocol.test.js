/**
 * T4 认领协议统一——PATCH in_progress 自动写 claimed_by + executor_kind=headed-session
 *
 * 覆盖 routes/tasks.js PATCH /api/brain/tasks/:task_id
 * 当 status → in_progress 时:
 *   - claimed_by = COALESCE(claimed_by, 'session:' + X-Session-Id || 'engine-patch')
 *   - executor_kind = COALESCE(executor_kind, 'headed-session')
 *
 * 架构文档: docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('PATCH /api/brain/tasks/:task_id — T4 认领协议 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('queued → in_progress 时 SQL 含 claimed_by COALESCE（有 X-Session-Id header）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'queued' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'task-1', status: 'in_progress', updated_at: new Date() }] }); // UPDATE

    const res = await request(app)
      .patch('/api/brain/tasks/task-1')
      .set('X-Session-Id', 'sess-abc123')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/claimed_by\s*=\s*COALESCE/i);
    // session: 值在参数里，不在 SQL 模板里（参数化查询）
    const updateParams = mockQuery.mock.calls[1][1];
    const sessionParam = updateParams.find(p => typeof p === 'string' && p.startsWith('session:'));
    expect(sessionParam).toBe('session:sess-abc123');
  });

  it('queued → in_progress 时 SQL 含 claimed_by COALESCE（无 X-Session-Id，用 engine-patch）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', status: 'in_progress', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-2')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/claimed_by\s*=\s*COALESCE/i);
    const updateParams = mockQuery.mock.calls[1][1];
    const sessionParam = updateParams.find(p => typeof p === 'string' && p.startsWith('session:'));
    expect(sessionParam).toBe('session:engine-patch');
  });

  it('queued → in_progress 时 SQL 含 executor_kind COALESCE headed-session', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-3', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-3', status: 'in_progress', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-3')
      .set('X-Session-Id', 'sess-xyz')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).toMatch(/executor_kind\s*=\s*COALESCE/i);
    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams).toContain('headed-session');
  });

  it('queued → in_progress 带 X-Session-Id 时参数含 session:<id>', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-4', status: 'queued' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-4', status: 'in_progress', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-4')
      .set('X-Session-Id', 'my-session-id-99')
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    const updateParams = mockQuery.mock.calls[1][1];
    const sessionParam = updateParams.find(p => typeof p === 'string' && p.startsWith('session:'));
    expect(sessionParam).toBe('session:my-session-id-99');
  });

  it('in_progress → completed 时不额外写 claimed_by/executor_kind（claimed_by 被清空）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-5', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-5', status: 'completed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-5')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    // completed 时清 claimed_by（已有逻辑），不写 executor_kind COALESCE
    expect(updateSql).not.toMatch(/executor_kind\s*=\s*COALESCE/i);
  });

  it('回归哨兵：非 in_progress 转换不受影响（queued→in_progress 外的其他转换不注入）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'task-6', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'task-6', status: 'failed', updated_at: new Date() }] });

    const res = await request(app)
      .patch('/api/brain/tasks/task-6')
      .send({ status: 'failed' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[1][0];
    expect(updateSql).not.toMatch(/executor_kind\s*=\s*COALESCE/i);
  });
});
