import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: (...a) => mockQuery(...a) } }));

// stub LangGraph heavy deps
vi.mock('@langchain/langgraph', () => ({
  Command: class { constructor(x) { this.x = x; } },
}));

import router from '../harness-pending-reviews.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.set('pool', { query: mockQuery });
  app.use('/', router);
  return app;
}

describe('GET /api/brain/harness/pending-reviews', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('返回待验收列表', async () => {
    mockQuery.mockResolvedValue({ rows: [
      { task_id: 'tid', pr_url: 'https://x/1', title: 'T', created_at: new Date().toISOString() }
    ] });
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].pr_url).toBe('https://x/1');
  });
});

// 认证合同（issue afc50c30）：approve/reject 需 x-approver-token + approved_by；
// 无认证细分场景在 harness-pending-reviews-auth.test.js，这里带合法认证走通主路径。
const TOKEN = 'route-test-token';

describe('POST /api/brain/harness/pending-reviews/:taskId/approve', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = TOKEN;
  });

  it('task 不存在 → 404', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const res = await request(makeApp()).post('/tid/approve')
      .set('x-approver-token', TOKEN)
      .send({ approved_by: 'alex' });
    expect(res.status).toBe(404);
  });

  it('task 存在 → 202 + ok:true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'tid', payload: {}, execution_attempts: 1 }] })
      .mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).post('/tid/approve')
      .set('x-approver-token', TOKEN)
      .send({ approved_by: 'alex' });
    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.approved).toBe(true);
    expect(res.body.approved_by).toBe('alex');
  });
});

describe('POST /api/brain/harness/pending-reviews/:taskId/reject', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    process.env.HARNESS_REVIEW_APPROVER_TOKEN = TOKEN;
  });

  it('reject → 202 + approved:false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [{ payload: {}, execution_attempts: 1 }] });
    const res = await request(makeApp()).post('/tid/reject')
      .set('x-approver-token', TOKEN)
      .send({ reason: 'not ready', approved_by: 'alex' });
    expect(res.status).toBe(202);
    expect(res.body.approved).toBe(false);
    expect(res.body.reason).toBe('not ready');
  });
});
