/**
 * 有头续接「待续」列表 + 认领（主理人 2026-10-11 决策）
 *  GET  /api/brain/handoffs/pending-resume          列出 result.pending_resume.status='pending' 的任务
 *  （销账 POST 见 handoff-resume-ack.test.js）
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
