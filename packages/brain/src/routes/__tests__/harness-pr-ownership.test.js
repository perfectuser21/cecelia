/**
 * routes/harness.js — GET /pr-ownership 只读归属端点单测。
 *
 * 背景（决策 e8f6134f / 事故 PR #4755）：CI 通用 auto-merge 曾用 PR 标题前缀
 * `feat(harness):` 判定 harness-owned PR，而标题是 LLM 自由撰写字段，标题写成
 * `fix(orchestrator): ...` 的 harness 产出直接绕过 evaluator+judge 被合并。
 * 本端点提供唯一非 LLM 撰写的权威判据：以 PR 号命中 initiative_runs.pr_url
 * （kernel 回调写入），或以 cp-* 分支的 task 短 id / workspace_spec.branch 命中
 * harness_attempts（kernel dispatch 写入 task_bundle）。命中即 harness_owned=true。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /pr-ownership', () => {
  let app;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const poolMod = await import('../../db.js');
    pool = poolMod.default;
    const routerMod = await import('../harness.js');
    app = express();
    app.use(express.json());
    app.use('/', routerMod.default);
  });

  it('既无 branch 也无 pr → 400', async () => {
    const res = await request(app).get('/pr-ownership');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('PR 号命中 initiative_runs.pr_url → harness_owned=true, matched_by=pr_url', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: '32b221b4-0000-0000-0000-000000000000' }] });
    const res = await request(app).get('/pr-ownership?pr=4755');
    expect(res.status).toBe(200);
    expect(res.body.harness_owned).toBe(true);
    expect(res.body.matched_by).toBe('pr_url');
    // SQL 以 /pull/<n> 形式匹配 pr_url（LLM 无法伪造 kernel 回调写入的 pr_url）
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/pr_url\s+LIKE/i);
    expect(pool.query.mock.calls[0][1]).toContain('4755');
  });

  it('回归 PR #4755：分支 cp-08101107-04e4690d 经 task 短 id 命中 harness_attempts → owned=true', async () => {
    // pr 未提供，分支查询：workspace_spec 精确未命中，task 短 id 命中
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // workspace_spec.branch 精确
      .mockResolvedValueOnce({ rows: [{ run_id: '32b221b4-0000-0000-0000-000000000000' }] }); // task 短 id
    const res = await request(app).get('/pr-ownership?branch=cp-08101107-04e4690d');
    expect(res.status).toBe(200);
    expect(res.body.harness_owned).toBe(true);
    expect(res.body.matched_by).toBe('branch_task_id');
    // 断言以分支里的 8 位 task 短 id 04e4690d 作为查询参数
    const taskIdCall = pool.query.mock.calls.find((c) =>
      (c[1] || []).some((p) => String(p).toLowerCase() === '04e4690d')
    );
    expect(taskIdCall).toBeTruthy();
  });

  it('fleet-worker 分支经 workspace_spec.branch 精确命中 → owned=true, matched_by=workspace_branch', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ run_id: '11111111-0000-0000-0000-000000000000' }],
    });
    const res = await request(app).get('/pr-ownership?branch=cp-fleet-generator-a1baae2b');
    expect(res.status).toBe(200);
    expect(res.body.harness_owned).toBe(true);
    expect(res.body.matched_by).toBe('workspace_branch');
  });

  it('手工 /dev 分支：所有归属查询均未命中 → harness_owned=false', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get(
      '/pr-ownership?branch=cp-08081317-gate3-deploy-fix-cd7e0028&pr=9999'
    );
    expect(res.status).toBe(200);
    expect(res.body.harness_owned).toBe(false);
    expect(res.body.matched_by).toBeNull();
  });

  it('DB 报错 → 500（脚本侧据此 fail-closed，不能默默返回 owned=false）', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection terminated'));
    const res = await request(app).get('/pr-ownership?pr=4755');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('非数字 pr 参数不进入 pr_url 查询（防脏参数）；无 branch 时视为无有效判据 → 400', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/pr-ownership?pr=4755;DROP');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    // 非法 pr 未触发任何 pr_url 查询
    expect(pool.query).not.toHaveBeenCalled();
  });
});
