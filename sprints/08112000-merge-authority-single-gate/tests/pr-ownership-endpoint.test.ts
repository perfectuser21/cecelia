/**
 * 合同测试 — Brain PR 归属求证端点 GET /api/brain/harness/pr-ownership。
 *
 * 禁 mock 边（CONTRACT IS LAW）：归属端点 ↔ initiative_runs 表是「只读 SELECT」，
 * 其真实 DB 读边由 contract-dod.md 的 [L2] BEHAVIOR（真 Brain + 真 psql seed/查）覆盖。
 * 本文件是 read-shape 单测：仅 mock db.js 验 handler 存在性与响应 shape（合同 9.12 明确允许），
 * 不替代 L2 真读。归属判据只凭 initiative_runs 记录（v2），禁标题/分支正则——本测断言响应 shape。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 拦截 harness.js 的 `import pool from '../db.js'`（按绝对解析路径命中）
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn() },
}));

describe('GET /pr-ownership 归属求证端点（read-shape）', () => {
  let router: any;
  let pool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../../packages/brain/src/db.js')).default;
    router = (await import('../../../packages/brain/src/routes/harness.js')).default;
  });

  function findHandler(method: string, path: string) {
    const layer = router.stack.find(
      (l: any) => l.route?.path === path && l.route?.methods?.[method],
    );
    const stack = layer?.route?.stack;
    return stack?.[stack.length - 1]?.handle;
  }

  function mockRes() {
    const res: any = { statusCode: 200 };
    res.status = vi.fn((c: number) => {
      res.statusCode = c;
      return res;
    });
    res.json = vi.fn((b: any) => {
      res.body = b;
      return res;
    });
    return res;
  }

  it('端点已注册（GET /pr-ownership 有 handler）', () => {
    expect(findHandler('get', '/pr-ownership')).toBeTypeOf('function');
  });

  it('命中 v2 initiative_run → owned=true（凭 initiative_runs 记录，非标题）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          run_id: '11111111-1111-1111-1111-111111111111',
          pr_url: 'https://github.com/o/r/pull/4759',
          matched_by: 'branch',
        },
      ],
    });
    const handler = findHandler('get', '/pr-ownership');
    const res = mockRes();
    await handler({ query: { branch: 'cp-08101246-643b5302' } }, res);
    expect(res.json).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.owned).toBe(true);
    expect(typeof body.run_id).toBe('string');
    // 归属只凭 initiative_runs 记录（v2），不凭标题——断言查询按 orchestrator_version 过滤
    const sql = String(pool.query.mock.calls[0][0]);
    expect(sql).toMatch(/orchestrator_version/);
  });

  it('无匹配 run → owned=false（不回归 /dev 的端点侧信号）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const handler = findHandler('get', '/pr-ownership');
    const res = mockRes();
    await handler({ query: { branch: 'cp-dev-not-a-real-run-xyz' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.owned).toBe(false);
    expect(body.run_id).toBeNull();
  });

  it('branch 与 pr_url 均缺失 → HTTP 400', async () => {
    const handler = findHandler('get', '/pr-ownership');
    const res = mockRes();
    await handler({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
