/**
 * 任务依赖 API（依赖单一写口的 HTTP 面，链 bf5088a3 棒5）。mock pool，无需真 DB；真库双写一致见
 * integration/task-governance-guards.pg.integration.test.js。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerTaskDependencyRoutes } from '../task-dependencies.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const query = vi.fn();
const app = () => {
  const router = express.Router();
  registerTaskDependencyRoutes(router, { pool: { query } });
  const a = express();
  a.use(express.json());
  a.use('/api/brain/tasks', router);
  return a;
};

function db({ existing = [A, B], cycle = false } = {}) {
  query.mockReset();
  query.mockImplementation(async (sql) => {
    const s = String(sql);
    if (/SELECT id, task_type FROM tasks WHERE id = \$1/.test(s)) return { rows: existing.includes(A) ? [{ id: A, task_type: 'dev' }] : [] };
    if (/SELECT id FROM tasks WHERE id = ANY/.test(s)) return { rows: existing.map((id) => ({ id })) };
    if (/WITH RECURSIVE/.test(s)) return { rows: cycle ? [{ hit: 1 }] : [] };
    if (/INSERT INTO task_dependencies/.test(s)) return { rowCount: 1, rows: [] };
    if (/DELETE FROM task_dependencies/.test(s)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 1 };
  });
}

beforeEach(() => db());

describe('POST /:id/dependencies', () => {
  it('合法依赖 → 201 且写边', async () => {
    const res = await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({ depends_on: [B] });
    expect(res.status).toBe(201);
    expect(res.body.added).toBe(1);
    expect(query.mock.calls.some(([s]) => /INSERT INTO task_dependencies/.test(String(s)))).toBe(true);
  });

  it('违规输入被拒：缺 depends_on → 400 depends_on_required', async () => {
    const res = await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('depends_on_required');
  });

  it('违规输入被拒：自环 → 400 dependency_self_loop，不写边', async () => {
    const res = await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({ depends_on: [A] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('dependency_self_loop');
    expect(query.mock.calls.some(([s]) => /INSERT INTO task_dependencies/.test(String(s)))).toBe(false);
  });

  it('违规输入被拒：成环 → 409 dependency_cycle', async () => {
    db({ cycle: true });
    const res = await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({ depends_on: [B] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('dependency_cycle');
  });

  it('违规输入被拒：edge_type 非法 → 400；:id 不是 uuid → 400；任务不存在 → 404', async () => {
    expect((await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({ depends_on: [B], edge_type: 'x' })).status).toBe(400);
    expect((await request(app()).post('/api/brain/tasks/nope/dependencies').send({ depends_on: [B] })).status).toBe(400);
    db({ existing: [B] });
    expect((await request(app()).post(`/api/brain/tasks/${A}/dependencies`).send({ depends_on: [B] })).status).toBe(404);
  });
});

describe('GET / DELETE', () => {
  it('GET 返回 blocked_by / blocks', async () => {
    const res = await request(app()).get(`/api/brain/tasks/${A}/dependencies`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ task_id: A, blocked_by: [], blocks: [] });
  });

  it('DELETE 删边 → 200；边不存在 → 404', async () => {
    expect((await request(app()).delete(`/api/brain/tasks/${A}/dependencies/${B}`)).status).toBe(200);
    query.mockImplementation(async (sql) => (/DELETE FROM task_dependencies/.test(String(sql)) ? { rowCount: 0, rows: [] } : { rows: [], rowCount: 0 }));
    expect((await request(app()).delete(`/api/brain/tasks/${A}/dependencies/${B}`)).status).toBe(404);
  });
});
