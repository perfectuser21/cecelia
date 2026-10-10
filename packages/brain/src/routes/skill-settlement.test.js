/**
 * 路 B 的三个入口（树+仓库 v3.0 第 4 刀）：
 *   POST /step-reconcile/:activityId      收敛对账（Step span vs Steps.readback）
 *   POST /skill-settlement/draft          读 spans + SKILL.md 起草候选（只出草稿，不写库）
 *   POST /skill-settlement/register       把草稿登记为候选 Activity（写库 + 一条待拍板）
 * 库函数全 mock；这里锁请求校验、状态码和参数传递。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), reconcileActivity: vi.fn(), judgeActivity: vi.fn(), draftFromSpans: vi.fn(), registerCandidate: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: mocks.query } }));
vi.mock('../middleware/internal-auth.js', () => ({ internalAuthOrLoopback: (_q, _s, next) => next() }));
vi.mock('../lib/step-reconcile.js', () => ({ reconcileActivity: mocks.reconcileActivity }));
vi.mock('../lib/activity-judge.js', () => ({ judgeActivity: mocks.judgeActivity }));
vi.mock('../lib/skill-settlement.js', async importOriginal => ({
  ...(await importOriginal()), draftFromSpans: mocks.draftFromSpans, registerCandidate: mocks.registerCandidate,
}));

let routes;
const reqRes = (body = {}, params = {}) => {
  const req = { body, params, query: {}, headers: {}, ip: '127.0.0.1' };
  const res = { _status: 200, _data: null, status(c) { this._status = c; return this; }, json(d) { this._data = d; return this; } };
  return { req, res };
};
const handler = (path) => routes.stack.find(l => l.route && l.route.methods.post && l.route.path === path).route.stack.at(-1).handle;
const ACT = 'c1000000-0000-4000-8000-000000000001';
const JOURNEY = 'a1000000-0000-4000-8000-000000000001';

beforeAll(async () => { vi.resetModules(); routes = (await import('./skill-settlement.js')).default; });
beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()));

describe('POST /step-reconcile/:activityId', () => {
  it('把 runs / required_green 传给裁判（手动触发），对账结果落裁判表并回报告', async () => {
    mocks.judgeActivity.mockResolvedValue({ verdict: 'converged', judgment_id: 'j1' });
    const { req, res } = reqRes({ runs: 7, required_green: 3 }, { activityId: ACT });
    await handler('/step-reconcile/:activityId')(req, res);
    expect(mocks.judgeActivity).toHaveBeenCalledWith(expect.anything(), ACT, { trigger: 'manual', runsWanted: 7, requiredGreen: 3 });
    expect(res._data).toEqual({ verdict: 'converged', judgment_id: 'j1' });
  });
  it('默认 5 次、连续 5 次绿', async () => {
    mocks.judgeActivity.mockResolvedValue({});
    const { req, res } = reqRes({}, { activityId: ACT });
    await handler('/step-reconcile/:activityId')(req, res);
    expect(mocks.judgeActivity.mock.calls[0][2]).toEqual({ trigger: 'manual', runsWanted: 5, requiredGreen: 5 });
  });
  it('id 不是 uuid / 次数越界 → 400；活动不存在 → 404', async () => {
    let r = reqRes({}, { activityId: 'nope' }); await handler('/step-reconcile/:activityId')(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ runs: 0 }, { activityId: ACT }); await handler('/step-reconcile/:activityId')(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ required_green: 99 }, { activityId: ACT }); await handler('/step-reconcile/:activityId')(r.req, r.res); expect(r.res._status).toBe(400);
    mocks.judgeActivity.mockRejectedValue(Object.assign(new Error('activity_not_found: x'), { status: 404 }));
    r = reqRes({}, { activityId: ACT }); await handler('/step-reconcile/:activityId')(r.req, r.res); expect(r.res._status).toBe(404);
  });
});

describe('POST /skill-settlement/draft', () => {
  const body = { run_ids: ['r1', 'r2'], capability_key: 'leadgen', activity_key: 'search', skill_md: '---\nname: 搜索\ndescription: 搜出视频。\n---' };
  it('读这几次运行的 Step span 起草，skill_md 解析成 name/承诺草稿', async () => {
    mocks.query.mockResolvedValue({ rows: [{ run_id: 'r1', evidence: { step_key: 'a' } }] });
    mocks.draftFromSpans.mockReturnValue({ steps: [], gaps: [] });
    const { req, res } = reqRes(body);
    await handler('/skill-settlement/draft')(req, res);
    expect(mocks.query.mock.calls[0][0]).toMatch(/FROM spans[\s\S]*run_id = ANY/);
    expect(mocks.query.mock.calls[0][1]).toEqual([['r1', 'r2']]);
    expect(mocks.draftFromSpans.mock.calls[0][0]).toMatchObject({ capabilityKey: 'leadgen', activityKey: 'search', skill: { name: '搜索', promise_draft: '搜出视频。' } });
    expect(res._data).toEqual({ steps: [], gaps: [] });
  });
  it('缺字段 → 400；没有带步骤的 span → 422', async () => {
    let r = reqRes({ ...body, run_ids: [] }); await handler('/skill-settlement/draft')(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ ...body, activity_key: 'Bad Key' }); await handler('/skill-settlement/draft')(r.req, r.res); expect(r.res._status).toBe(400);
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.draftFromSpans.mockImplementation(() => { throw new Error('no_step_spans: x'); });
    r = reqRes(body); await handler('/skill-settlement/draft')(r.req, r.res); expect(r.res._status).toBe(422);
  });
});

describe('POST /skill-settlement/register', () => {
  const draft = { activity: { key: 'search', capability_key: 'leadgen', name: '搜索' }, steps: [{ key: 'a', order: 1 }], gaps: [] };
  it('新登记 → 201；已存在 → 200 不覆盖', async () => {
    mocks.registerCandidate.mockResolvedValueOnce({ created: true, id: 'x' });
    let r = reqRes({ draft, journey_id: JOURNEY, skill_name: '搜索' });
    await handler('/skill-settlement/register')(r.req, r.res);
    expect(r.res._status).toBe(201);
    expect(mocks.registerCandidate.mock.calls[0][1]).toMatchObject({ draft, journeyId: JOURNEY, skillName: '搜索' });
    mocks.registerCandidate.mockResolvedValueOnce({ created: false, existing: true, id: 'x' });
    r = reqRes({ draft, journey_id: JOURNEY });
    await handler('/skill-settlement/register')(r.req, r.res);
    expect(r.res._status).toBe(200);
  });
  it('草稿缺 Activity/Steps 或 journey_id 不是 uuid → 400', async () => {
    let r = reqRes({ draft: { activity: {}, steps: [] }, journey_id: JOURNEY }); await handler('/skill-settlement/register')(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({ draft, journey_id: 'x' }); await handler('/skill-settlement/register')(r.req, r.res); expect(r.res._status).toBe(400);
    expect(mocks.registerCandidate).not.toHaveBeenCalled();
  });
});
