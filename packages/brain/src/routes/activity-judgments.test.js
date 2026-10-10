/**
 * 裁判结果查询接口（五块模型·裁判，决策 de6dff5d）：
 *   GET /activities/:activityId/judgments/latest
 *   GET /activities/:activityId/judgments?limit=
 *   GET /activities/:activityId/version-compare?candidate=&baseline=&min_runs=&max_runs=&tolerance=
 * 库函数全 mock；锁参数校验、默认值与状态码。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getLatestJudgment: vi.fn(), listJudgments: vi.fn(), compareActivityVersions: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../lib/activity-judge.js', () => ({ getLatestJudgment: mocks.getLatestJudgment, listJudgments: mocks.listJudgments }));
vi.mock('../lib/activity-version-compare.js', () => ({ compareActivityVersions: mocks.compareActivityVersions, DEFAULT_MIN_RUNS: 5 }));

let routes;
const ACT = 'c1000000-0000-4000-8000-000000000001';
const V1 = 'd1000000-0000-4000-8000-000000000001';
const V2 = 'd1000000-0000-4000-8000-000000000002';
const reqRes = (params, query = {}) => {
  const req = { body: {}, params, query, headers: {}, ip: '127.0.0.1' };
  const res = { _status: 200, _data: null, status(c) { this._status = c; return this; }, json(d) { this._data = d; return this; } };
  return { req, res };
};
const get = path => routes.stack.find(l => l.route?.methods.get && l.route.path === path).route.stack.at(-1).handle;

beforeAll(async () => { vi.resetModules(); routes = (await import('./activity-judgments.js')).default; });
beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()));

describe('GET /activities/:activityId/judgments/latest', () => {
  it('回最新一条裁判', async () => {
    mocks.getLatestJudgment.mockResolvedValue({ id: 'j1', verdict: 'converged' });
    const { req, res } = reqRes({ activityId: ACT });
    await get('/activities/:activityId/judgments/latest')(req, res);
    expect(mocks.getLatestJudgment).toHaveBeenCalledWith(expect.anything(), ACT);
    expect(res._data).toEqual({ judgment: { id: 'j1', verdict: 'converged' } });
  });
  it('还没裁判过 → 404；id 非 uuid → 400；库错 → 500', async () => {
    mocks.getLatestJudgment.mockResolvedValue(null);
    let r = reqRes({ activityId: ACT }); await get('/activities/:activityId/judgments/latest')(r.req, r.res); expect(r.res._status).toBe(404);
    r = reqRes({ activityId: 'x' }); await get('/activities/:activityId/judgments/latest')(r.req, r.res); expect(r.res._status).toBe(400);
    mocks.getLatestJudgment.mockRejectedValue(new Error('db'));
    r = reqRes({ activityId: ACT }); await get('/activities/:activityId/judgments/latest')(r.req, r.res); expect(r.res._status).toBe(500);
  });
});

describe('GET /activities/:activityId/judgments', () => {
  it('默认 20 条，limit 限 1..100', async () => {
    mocks.listJudgments.mockResolvedValue([{ id: 'j1' }]);
    let r = reqRes({ activityId: ACT }); await get('/activities/:activityId/judgments')(r.req, r.res);
    expect(mocks.listJudgments).toHaveBeenCalledWith(expect.anything(), ACT, { limit: 20 });
    expect(r.res._data).toEqual({ judgments: [{ id: 'j1' }], total: 1 });
    r = reqRes({ activityId: ACT }, { limit: '500' }); await get('/activities/:activityId/judgments')(r.req, r.res); expect(r.res._status).toBe(400);
  });
});

describe('GET /activities/:activityId/version-compare', () => {
  const path = '/activities/:activityId/version-compare';
  it('候选/基线/样本下限/容差透传，回对比结果', async () => {
    mocks.compareActivityVersions.mockResolvedValue({ verdict: 'not_worse' });
    const { req, res } = reqRes({ activityId: ACT }, { candidate: V2, baseline: V1, min_runs: '8', max_runs: '30', tolerance: '0.05' });
    await get(path)(req, res);
    expect(mocks.compareActivityVersions).toHaveBeenCalledWith(expect.anything(), ACT,
      { candidateVersionId: V2, baselineVersionId: V1, minRuns: 8, maxRuns: 30, tolerance: 0.05 });
    expect(res._data).toEqual({ verdict: 'not_worse' });
  });
  it('基线可省（由库函数取当前版本），默认下限 5 / 最近 50 次 / 容差 0', async () => {
    mocks.compareActivityVersions.mockResolvedValue({});
    const { req, res } = reqRes({ activityId: ACT }, { candidate: V2 });
    await get(path)(req, res);
    expect(mocks.compareActivityVersions.mock.calls[0][2]).toEqual({ candidateVersionId: V2, baselineVersionId: null, minRuns: 5, maxRuns: 50, tolerance: 0 });
  });
  it('缺候选/非 uuid/参数越界 → 400；版本不属于该 Activity → 404', async () => {
    let r = reqRes({ activityId: ACT }, {}); await get(path)(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ activityId: ACT }, { candidate: 'x' }); await get(path)(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ activityId: ACT }, { candidate: V2, min_runs: '0' }); await get(path)(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ activityId: ACT }, { candidate: V2, tolerance: '2' }); await get(path)(r.req, r.res); expect(r.res._status).toBe(400);
    mocks.compareActivityVersions.mockRejectedValue(Object.assign(new Error('version_not_found'), { status: 404 }));
    r = reqRes({ activityId: ACT }, { candidate: V2 }); await get(path)(r.req, r.res); expect(r.res._status).toBe(404);
  });
});
