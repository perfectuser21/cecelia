/**
 * 有头续接「待续」列表 + 认领（主理人 2026-10-11 决策）
 *  GET  /api/brain/handoffs/pending-resume          列出 result.pending_resume.status='pending' 的任务
 *  POST /api/brain/handoffs/pending-resume/:id/ack  新的有头会话接上后标 resumed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../handoffs.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/handoffs', router);
  return app;
}
const req = async () => (await import('supertest')).default;
const TID = '33333333-3333-4333-8333-333333333333';

describe('GET /api/brain/handoffs/pending-resume', () => {
  beforeEach(() => mockQuery.mockReset());

  it('返回谁的任务 / 下一步 / 交接全文，SQL 只取 pending', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: TID, title: '有头任务', status: 'completed', task_type: 'dev', executor_kind: 'headed-session',
      payload: { repo: 'cecelia' }, claimed_by: null,
      pending_resume: { status: 'pending', items: [{ index: 0, title: '接着做 X' }], created_at: '2026-10-11T00:00:00.000Z' },
      handoff: { title: 'h', session_id: 'sess-1', next_steps: [{ kind: 'resume_headed', title: '接着做 X' }] },
    }] });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs/pending-resume');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const p = res.body.pending[0];
    expect(p).toMatchObject({ task_id: TID, title: '有头任务', repo: 'cecelia', session_id: 'sess-1', executor_kind: 'headed-session' });
    expect(p.items).toEqual([{ index: 0, title: '接着做 X' }]);
    expect(p.handoff.next_steps[0].kind).toBe('resume_headed');
    expect(mockQuery.mock.calls[0][0]).toMatch(/pending_resume'->>'status'\s*=\s*'pending'/);
  });

  it('不被 GET / 吞掉（路由顺序），limit 参数化', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await (await req())(await makeApp()).get('/api/brain/handoffs/pending-resume?limit=5');
    expect(res.body).toEqual({ pending: [], total: 0 });
    expect(mockQuery.mock.calls[0][1]).toContain(5);
  });
});

describe('POST /api/brain/handoffs/pending-resume/:taskId/ack', () => {
  beforeEach(() => mockQuery.mockReset());

  it('pending → resumed，记 resumed_by', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: TID, pending_resume: { status: 'resumed', resumed_by: 'sess-2' } }] });
    const res = await (await req())(await makeApp())
      .post(`/api/brain/handoffs/pending-resume/${TID}/ack`).send({ resumed_by: 'sess-2' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, task_id: TID, pending_resume: { status: 'resumed' } });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE tasks/);
    expect(sql).toMatch(/pending_resume'->>'status'\s*=\s*'pending'/);
    expect(params).toContain(TID);
    expect(params).toContain('sess-2');
  });

  it('不存在或已非 pending → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await (await req())(await makeApp()).post(`/api/brain/handoffs/pending-resume/${TID}/ack`).send({});
    expect(res.status).toBe(404);
  });

  it('非法 uuid → 400', async () => {
    const res = await (await req())(await makeApp()).post('/api/brain/handoffs/pending-resume/xx/ack').send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
