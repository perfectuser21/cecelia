import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock db: pool.connect() → client(query/release) + pool.query()
const clientQuery = vi.fn();
const poolQuery = vi.fn();
vi.mock('../../db.js', () => ({
  default: {
    query: (...a) => poolQuery(...a),
    connect: vi.fn(async () => ({ query: (...a) => clientQuery(...a), release: vi.fn() })),
  },
}));
// staging-promote: 内部线 promote 用 mock，绝不跑真脚本
vi.mock('../../staging-promote.js', async (orig) => {
  const actual = await orig();
  return { ...actual, defaultPromoteExec: () => () => ({ ok: true, output: 'mock promote' }) };
});

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  const routerMod = await import('../harness.js');
  app = express();
  app.use(express.json());
  app.use('/', routerMod.default);
});

const RID = '11111111-1111-1111-1111-111111111111';

// client.query 序列：BEGIN, SELECT FOR UPDATE, UPDATE promoting, COMMIT
function mockPending(verdict = 'PASS') {
  clientQuery
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: RID, pr_url: 'https://pr/x', verdict, promote_status: 'pending_promote' }] }) // SELECT
    .mockResolvedValueOnce({}) // UPDATE promoting
    .mockResolvedValueOnce({}); // COMMIT
  poolQuery.mockResolvedValue({ rows: [] }); // final UPDATE
}

describe('POST /promote/:resultId — 放行回流幂等状态机', () => {
  it('客户线 pending_promote → promoted（决策1：不跨 repo 打 zenithjoy 生产，只记确认）', async () => {
    mockPending();
    const res = await request(app).post(`/promote/${RID}`).send({ base_repo: 'perfectuser21/zenithjoy-workspace' });
    expect(res.status).toBe(200);
    expect(res.body.promote_status).toBe('promoted');
    // 没跑 promote 脚本（客户线），但最终 UPDATE 落 promoted
    const finalUpd = poolQuery.mock.calls.find(([sql, p]) => /promote_status = \$2/.test(sql) && p.includes('promoted'));
    expect(finalUpd).toBeTruthy();
  });

  it('非 pending_promote（已 promoted）→ 409，防重复 promote（幂等）', async () => {
    clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: RID, promote_status: 'auto_promoted' }] }) // SELECT
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).post(`/promote/${RID}`).send({});
    expect(res.status).toBe(409);
    expect(res.body.promote_status).toBe('auto_promoted');
  });

  it('result 不存在 → 404', async () => {
    clientQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT empty
      .mockResolvedValueOnce({}); // ROLLBACK
    const res = await request(app).post(`/promote/${RID}`).send({});
    expect(res.status).toBe(404);
  });

  it('非法 resultId → 400', async () => {
    const res = await request(app).post('/promote/not-a-uuid').send({});
    expect(res.status).toBe(400);
  });
});
