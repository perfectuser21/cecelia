/**
 * 有头续接「待续」销账（主理人 2026-10-11 决策）
 *  POST /api/brain/handoffs/pending-resume/:taskId/ack  新的有头会话接上后标 resumed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: ackRouter } = await import('../handoff-resume-ack.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/handoffs/pending-resume', ackRouter);
  return app;
}
const req = async () => (await import('supertest')).default;
const TID = '33333333-3333-4333-8333-333333333333';

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
