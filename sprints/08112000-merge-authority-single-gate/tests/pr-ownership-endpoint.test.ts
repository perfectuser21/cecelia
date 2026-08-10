// TDD Red — Brain PR 归属求证端点 GET /api/brain/harness/pr-ownership。
// 端点为只读（SELECT initiative_runs / tasks），非 DB 写路径；本单元测试 mock db.js 仅验
// handler 存在性与响应 shape/契约（owned/run_id/pr_url/matched_by + 400）。
// 端点 ↔ initiative_runs 真实 DB 读边由 contract-dod.md 的 [L2] BEHAVIOR（真 psql+curl）覆盖。
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => {
  const mockPool = { query: vi.fn() };
  return { default: mockPool };
});

import pool from '../../../packages/brain/src/db.js';
import harnessRoutes from '../../../packages/brain/src/routes/harness.js';

function findHandler(path: string) {
  const layer = (harnessRoutes as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.get,
  );
  return layer?.route?.stack?.slice(-1)[0]?.handle;
}

function mockReqRes(query: Record<string, string> = {}) {
  const req: any = { query };
  const res: any = {
    _data: null,
    _status: 200,
    json(d: any) { this._data = d; return this; },
    status(c: number) { this._status = c; return this; },
  };
  return { req, res };
}

describe('GET /api/brain/harness/pr-ownership [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('端点已注册（route handler 存在）', () => {
    expect(typeof findHandler('/pr-ownership')).toBe('function');
  });

  it('命中 v2 initiative_run → owned=true + run_id + pr_url', async () => {
    (pool as any).query.mockResolvedValueOnce({
      rows: [{ run_id: '11111111-1111-1111-1111-111111111111', pr_url: 'https://github.com/o/r/pull/4759' }],
    });
    const { req, res } = mockReqRes({ branch: 'cp-08101246-643b5302' });
    await findHandler('/pr-ownership')(req, res);
    expect(res._status).toBe(200);
    expect(res._data.owned).toBe(true);
    expect(res._data.run_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(res._data.pr_url).toBe('https://github.com/o/r/pull/4759');
    expect(['branch', 'pr_url']).toContain(res._data.matched_by);
  });

  it('无匹配 run → owned=false（run_id/pr_url 为 null，matched_by null）', async () => {
    (pool as any).query.mockResolvedValue({ rows: [] });
    const { req, res } = mockReqRes({ branch: 'cp-0704084753-manual-dev' });
    await findHandler('/pr-ownership')(req, res);
    expect(res._status).toBe(200);
    expect(res._data.owned).toBe(false);
    expect(res._data.run_id).toBe(null);
    expect(res._data.matched_by).toBe(null);
  });

  it('branch 与 pr_url 均缺失 → HTTP 400', async () => {
    const { req, res } = mockReqRes({});
    await findHandler('/pr-ownership')(req, res);
    expect(res._status).toBe(400);
    expect(typeof res._data.error).toBe('string');
  });
});
