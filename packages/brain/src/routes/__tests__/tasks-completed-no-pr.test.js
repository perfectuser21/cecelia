/**
 * PATCH /api/brain/tasks/:task_id — 完成态按执行面分流（PR1）
 *
 * 背景：`getTaskType(task_type).surface === 'openclaw-agent'` 的类型（如 qiumi_task）
 * 不产 PR，完成闸是按 PR 语义设计的（review_required/pr_merged_at），这类任务的销账态
 * 应该是 `completed_no_pr`，不是 `completed`。写 `completed` 一律 409 引导改写
 * `completed_no_pr`；其余存量类型（如 research/dev）今天 PATCH completed 合法，不动。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.fn();
const mockBlockTask = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: (...args) => mockBlockTask(...args),
}));

/** 铺一行 SELECT 返回的任务行，字段照 tasks.js 里 SELECT 的列对齐。 */
function mockTaskRow(overrides) {
  mockQuery.mockResolvedValueOnce({
    rows: [{
      id: 't1',
      status: 'in_progress',
      claimed_by: 'x',
      executor_kind: null,
      task_type: 'dev',
      orchestrator: null,
      review_required_raw: null,
      review_status: null,
      pr_url: null,
      pr_merged_at: null,
      ...overrides,
    }],
  });
}

/** 取最近一次 UPDATE tasks 的 SQL 文本（mockQuery 第二次调用即 UPDATE）。 */
function lastUpdateSql() {
  const updateCall = mockQuery.mock.calls.find(([sql]) => /^\s*UPDATE tasks/i.test(sql));
  return updateCall ? updateCall[0] : '';
}

describe('PATCH /tasks/:id 完成态按执行面分流（PR1）', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockBlockTask.mockClear();
    mockBlockTask.mockResolvedValue({ success: true });
    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  it('qiumi_task 写 completed → 409 USE_COMPLETED_NO_PR', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'qiumi_task', claimed_by: 'x' });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('USE_COMPLETED_NO_PR');
    expect(res.body.hint).toContain('completed_no_pr');
  });

  it('qiumi_task 写 completed_no_pr → 200，且清 claimed_by/claimed_at', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'qiumi_task', claimed_by: 'x' });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed_no_pr', updated_at: 'x' }] });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed_no_pr' });
    expect(res.status).toBe(200);
    const update = lastUpdateSql();
    expect(update).toMatch(/claimed_by = NULL/);
    expect(update).toMatch(/claimed_at = NULL/);
    // completed_no_pr 与 completed 同属"任务结束"的生命周期事实，callback-processor.js/
    // execution.js 既有的 completed_no_pr 路径会设 completed_at——这条 PATCH 路径也不能漏。
    expect(update).toMatch(/completed_at = COALESCE\(completed_at, NOW\(\)\)/);
  });

  it('research 写 completed 行为不变（不进 409）', async () => {
    mockTaskRow({ status: 'in_progress', task_type: 'research', review_required_raw: null, pr_url: null });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'completed', updated_at: 'x' }] });
    const res = await request(app).patch('/api/brain/tasks/t1').send({ status: 'completed' });
    expect(res.status).toBe(200);
  });
});
