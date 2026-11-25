import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// mock db: pool.connect() → client(query/release) + pool.query()
const clientQuery = vi.fn();
const poolQuery = vi.fn();
const promote = vi.fn(() => ({ ok: true, output: 'mock promote' }));
vi.mock('../../db.js', () => ({
  default: {
    query: (...a) => poolQuery(...a),
    connect: vi.fn(async () => ({ query: (...a) => clientQuery(...a), release: vi.fn() })),
  },
}));
// staging-promote: 内部线 promote 用 mock，绝不跑真脚本
vi.mock('../../staging-promote.js', async (orig) => {
  const actual = await orig();
  return { ...actual, defaultPromoteExec: () => promote };
});

let app;
beforeEach(async () => {
  clientQuery.mockReset();
  poolQuery.mockReset();
  promote.mockClear();
  const routerMod = await import('../staging.js');
  app = express();
  app.use(express.json());
  app.use('/', routerMod.default);
});

const RID = '11111111-1111-1111-1111-111111111111';

// client.query 序列：BEGIN, SELECT FOR UPDATE, UPDATE promoting, COMMIT
function mockPending(row) {
  clientQuery
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: RID, verdict: 'PASS', promote_status: 'pending_promote', ...row }] }) // SELECT
    .mockResolvedValueOnce({}) // UPDATE promoting
    .mockResolvedValueOnce({}); // COMMIT
  poolQuery.mockResolvedValue({ rows: [] }); // final UPDATE
}

describe('POST /promote/:resultId — 放行回流幂等状态机', () => {
  it.each([
    [{ pr_url: 'https://github.com/perfectuser21/zenithjoy-workspace/pull/2588' }, {}],
    [{ pr_url: 'https://github.com/perfectuser21/zenithjoy-workspace/pull/2588' }, { base_repo: 'cecelia' }],
    [{ task_payload: { baseRepo: 'ZenithJoy' } }, {}],
    [{ staging_port: 5201 }, {}],
  ])('旧客户验收只读，确认返回 410', async (row, body) => {
    mockPending(row);
    const res = await request(app).post(`/promote/${RID}`).send(body);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('zenithjoy_staging_retired');
    expect(promote).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it.each([
    { pr_url: 'https://github.com/perfectuser21/cecelia/pull/6995' },
    { task_payload: { base_repo: 'perfectuser21/cecelia' } },
  ])('按已存 Cecelia 仓库确认，运行内部晋级', async (row) => {
    mockPending(row);
    const res = await request(app).post(`/promote/${RID}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.promote_status).toBe('promoted');
    expect(promote).toHaveBeenCalledOnce();
    expect(poolQuery).toHaveBeenCalledWith(expect.any(String), [RID, 'promoted', 'mock promote', 'owner']);
  });

  it.each([
    { task_payload: { base_repo: 'acme/other-product' } },
    { pr_url: 'https://github.com/acme/other-product/pull/9', task_payload: { base_repo: 'cecelia' } },
    { pr_url: 'https://github.com/perfectuser21/cecelia/pull/6995', task_payload: { base_repo: 'acme/other-product' } },
  ])('第三方仓库确认只记台账', async (row) => {
    mockPending(row);
    const res = await request(app).post(`/promote/${RID}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.promote_status).toBe('promoted');
    expect(promote).not.toHaveBeenCalled();
    expect(poolQuery).toHaveBeenCalledWith(expect.any(String), [RID, 'promoted', 'owner confirmed', 'owner']);
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
