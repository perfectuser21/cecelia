/**
 * routes/tasks.js — PATCH result 持久化 + completed 幂等补写 [BEHAVIOR]
 *
 * issue a638f840 实证：harness-report Step 1 回写 task.result 双重损坏——
 * ① handler setClauses 从不写 result 列（happy path 也静默丢弃）
 * ② task 已 completed 后补写被 INVALID_TRANSITION 409 永久堵死。
 * 修法：result COALESCE merge 写入；status===currentStatus 视为幂等 no-op
 * （跳过 transition 校验/status_history/事件），仍应用 result 更新。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

describe('PATCH /api/brain/tasks/:task_id — result 补写 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    // 默认兜底：事件/KR 等后续查询一律返回空行，防未 mock 的调用炸 rows
    mockQuery.mockResolvedValue({ rows: [] });
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('completed task + body.result → 200 且 UPDATE 含 result COALESCE merge（补写场景，原 409）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't1', status: 'completed' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] }); // UPDATE

    const res = await request(app)
      .patch('/api/brain/tasks/t1')
      .send({ status: 'completed', result: { pr_url: 'https://x/pr/1', merged: true } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\|/);
    // 参数绑定：result 对象序列化后确实进了 params
    expect(updCall[1]).toContain(JSON.stringify({ pr_url: 'https://x/pr/1', merged: true }));
    // 幂等 no-op：不追加 status_history
    expect(updCall[0]).not.toMatch(/status_history/);
  });

  it('completed→completed 无 result → 200 幂等 no-op（不 409、不写 history）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't2', status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t2')
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).not.toMatch(/status_history/);
  });

  it('in_progress→completed 带 result → 200 且 status 与 result 同时进 UPDATE', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't3', status: 'in_progress' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t3')
      .send({ status: 'completed', result: { pr_url: 'https://x/pr/2' } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/status = \$/);
    expect(updCall[0]).toMatch(/status_history/);
    expect(updCall[0]).toMatch(/result = COALESCE\(result, '\{\}'::jsonb\) \|\|/);
  });

  it('只带 result 无 status → 200（纯补写合法）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 't4', status: 'completed' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });

    const res = await request(app)
      .patch('/api/brain/tasks/t4')
      .send({ result: { total_cost_usd: 7.38 } });

    expect(res.status).toBe(200);
    const updCall = mockQuery.mock.calls.find(([sql]) => /UPDATE tasks/.test(sql));
    expect(updCall[0]).toMatch(/result = COALESCE/);
    expect(updCall[0]).not.toMatch(/status = \$/);
  });

  it('既无 status 也无 result → 400（守住原必填语义）', async () => {
    const res = await request(app).patch('/api/brain/tasks/t5').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_FIELD');
  });

  it('result 非对象（数组/字符串/null）→ 400', async () => {
    const resArr = await request(app)
      .patch('/api/brain/tasks/t6')
      .send({ result: [1, 2] });
    expect(resArr.status).toBe(400);

    const resStr = await request(app)
      .patch('/api/brain/tasks/t6')
      .send({ result: 'x' });
    expect(resStr.status).toBe(400);

    const resNull = await request(app)
      .patch('/api/brain/tasks/t6')
      .send({ result: null });
    expect(resNull.status).toBe(400);
  });

  it('回归哨兵：completed → failed 仍 409（终态间迁移不放行）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't7', status: 'completed' }] });
    const res = await request(app)
      .patch('/api/brain/tasks/t7')
      .send({ status: 'failed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });
});
