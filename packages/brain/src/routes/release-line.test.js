/** 发布线接口（迁移 541）：库函数全 mock；锁参数校验、状态码透传、写接口挂内部鉴权。 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActivityRelease: vi.fn(), listReleaseEvents: vi.fn(), listContentVersions: vi.fn(), getProductionRecipe: vi.fn(), listProductionRecipes: vi.fn(),
  promoteActivity: vi.fn(), groupPromote: vi.fn(), rollbackActivity: vi.fn(), reconcileReleaseLine: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../lib/release-line-query.js', () => ({ getActivityRelease: mocks.getActivityRelease, listReleaseEvents: mocks.listReleaseEvents,
  listContentVersions: mocks.listContentVersions, getProductionRecipe: mocks.getProductionRecipe, listProductionRecipes: mocks.listProductionRecipes }));
vi.mock('../lib/release-line-gate.js', () => ({ promoteActivity: mocks.promoteActivity, groupPromote: mocks.groupPromote }));
vi.mock('../lib/release-line-rollback.js', () => ({ rollbackActivity: mocks.rollbackActivity }));
vi.mock('../lib/release-line.js', () => ({ reconcileReleaseLine: mocks.reconcileReleaseLine }));

let routes;
const ID = 'c1000000-0000-4000-8000-000000000001';
const reqRes = (params = {}, query = {}, body = {}) => ({
  req: { body, params, query, headers: {}, ip: '127.0.0.1' },
  res: { _status: 200, _data: null, status(c) { this._status = c; return this; }, json(d) { this._data = d; return this; } },
});
const layer = (method, path) => routes.stack.find(l => l.route?.methods[method] && l.route.path === path).route;
const handler = (method, path) => layer(method, path).stack.at(-1).handle;

beforeAll(async () => { vi.resetModules(); routes = (await import('./release-line.js')).default; });
beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()));

describe('读接口', () => {
  it('GET release：200 / 404 / 非 uuid 400', async () => {
    mocks.getActivityRelease.mockResolvedValueOnce({ activity_id: ID, production: { version_no: 2 } }).mockResolvedValueOnce(null);
    let r = reqRes({ id: ID }); await handler('get', '/activities/:id/release')(r.req, r.res);
    expect(r.res._data.production.version_no).toBe(2);
    r = reqRes({ id: ID }); await handler('get', '/activities/:id/release')(r.req, r.res); expect(r.res._status).toBe(404);
    r = reqRes({ id: 'x' }); await handler('get', '/activities/:id/release')(r.req, r.res); expect(r.res._status).toBe(400);
  });
  it('production-recipe：commit 须 40 位 sha；没有配方 404', async () => {
    let r = reqRes({ id: ID }, { commit: 'abc' }); await handler('get', '/workflows/:id/production-recipe')(r.req, r.res); expect(r.res._status).toBe(400);
    mocks.getProductionRecipe.mockResolvedValue(null);
    r = reqRes({ id: ID }); await handler('get', '/workflows/:id/production-recipe')(r.req, r.res); expect(r.res._status).toBe(404);
  });
  it('release-events limit 越界 400', async () => {
    const r = reqRes({ id: ID }, { limit: '0' }); await handler('get', '/activities/:id/release-events')(r.req, r.res); expect(r.res._status).toBe(400);
  });
});

describe('写接口', () => {
  it('晋级/成组/退回/补账都挂了内部鉴权中间件', () => {
    for (const [m, p] of [['post', '/activities/:id/promotions'], ['post', '/release-line/group-promotions'], ['post', '/activities/:id/rollbacks'], ['post', '/release-line/reconcile']])
      expect(layer(m, p).stack.length).toBe(2);
  });
  it('晋级：库函数给的状态码原样返回（201 / 409 GATE_FAILED），抛错带 code/details', async () => {
    mocks.promoteActivity.mockResolvedValueOnce({ status: 409, code: 'GATE_FAILED' })
      .mockRejectedValueOnce(Object.assign(new Error('接口变了'), { status: 409, code: 'INTERFACE_CHANGED', details: { affected: [1] } }));
    let r = reqRes({ id: ID }, {}, { candidate_version_id: ID, actor: 't' });
    await handler('post', '/activities/:id/promotions')(r.req, r.res);
    expect(r.res._status).toBe(409); expect(r.res._data.code).toBe('GATE_FAILED');
    r = reqRes({ id: ID }, {}, {}); await handler('post', '/activities/:id/promotions')(r.req, r.res);
    expect(r.res._data).toMatchObject({ code: 'INTERFACE_CHANGED', details: { affected: [1] } });
  });
  it('退回成功 201', async () => {
    mocks.rollbackActivity.mockResolvedValue({ event: { id: 1 } });
    const r = reqRes({ id: ID }, {}, { actor: 'a', reason: 'r' }); await handler('post', '/activities/:id/rollbacks')(r.req, r.res);
    expect(r.res._status).toBe(201);
  });
});
