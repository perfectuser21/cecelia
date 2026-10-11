/** 技能工厂台账接口（迁移 547）：库函数全 mock；锁参数校验、状态码透传、写接口挂内部鉴权。 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  listLedger: vi.fn(), getLedger: vi.fn(), createLedger: vi.fn(), patchLedger: vi.fn(), transitionLedger: vi.fn(), recordRun: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../lib/factory-ledger.js', async (orig) => ({ ...(await orig()), ...mocks }));

let routes;
const ID = 'c1000000-0000-4000-8000-000000000547';
const reqRes = (params = {}, query = {}, body = {}) => ({
  req: { body, params, query, headers: {}, ip: '127.0.0.1' },
  res: { _status: 200, _data: null, status(c) { this._status = c; return this; }, json(d) { this._data = d; return this; } },
});
const layer = (method, path) => routes.stack.find(l => l.route?.methods[method] && l.route.path === path).route;
const handler = (method, path) => layer(method, path).stack.at(-1).handle;
const httpError = (status, code) => Object.assign(new Error(code), { status, code });

beforeAll(async () => { vi.resetModules(); routes = (await import('./factory-ledger.js')).default; });
beforeEach(() => Object.values(mocks).forEach(m => m.mockReset()));

describe('读接口', () => {
  it('GET 列表：透传 stage / workflow_id 过滤；stage 越界 400', async () => {
    mocks.listLedger.mockResolvedValue([{ id: ID, stage: 2 }]);
    let r = reqRes({}, { stage: '2' }); await handler('get', '/factory/ledger')(r.req, r.res);
    expect(r.res._data.ledger).toHaveLength(1);
    expect(mocks.listLedger.mock.calls[0][1]).toMatchObject({ stage: 2 });
    r = reqRes({}, { stage: '8' }); await handler('get', '/factory/ledger')(r.req, r.res); expect(r.res._status).toBe(400);
    r = reqRes({}, { workflow_id: 'x' }); await handler('get', '/factory/ledger')(r.req, r.res); expect(r.res._status).toBe(400);
  });
  it('GET 单行：200 带事件 / 404 / 非 uuid 400', async () => {
    mocks.getLedger.mockResolvedValueOnce({ ledger: { id: ID }, events: [] }).mockResolvedValueOnce(null);
    let r = reqRes({ id: ID }); await handler('get', '/factory/ledger/:id')(r.req, r.res);
    expect(r.res._data).toMatchObject({ ledger: { id: ID }, events: [] });
    r = reqRes({ id: ID }); await handler('get', '/factory/ledger/:id')(r.req, r.res); expect(r.res._status).toBe(404);
    r = reqRes({ id: 'nope' }); await handler('get', '/factory/ledger/:id')(r.req, r.res); expect(r.res._status).toBe(400);
  });
});

describe('写接口', () => {
  it('四个写接口都挂内部鉴权（handler 前有中间件）', () => {
    for (const [m, p] of [['post', '/factory/ledger'], ['patch', '/factory/ledger/:id'], ['post', '/factory/ledger/:id/transition'], ['post', '/factory/ledger/:id/runs']])
      expect(layer(m, p).stack.length).toBeGreaterThan(1);
  });
  it('POST 建行 201；参数错 400 不进库；重复进厂 409 透传', async () => {
    mocks.createLedger.mockResolvedValueOnce({ ledger: { id: ID, stage: 1 } }).mockRejectedValueOnce(httpError(409, 'LEDGER_EXISTS'));
    let r = reqRes({}, {}, { workflow_id: ID }); await handler('post', '/factory/ledger')(r.req, r.res);
    expect(r.res._status).toBe(201);
    r = reqRes({}, {}, { workflow_id: ID }); await handler('post', '/factory/ledger')(r.req, r.res);
    expect(r.res._status).toBe(409); expect(r.res._data.code).toBe('LEDGER_EXISTS');
    r = reqRes({}, {}, {}); await handler('post', '/factory/ledger')(r.req, r.res);
    expect(r.res._status).toBe(400); expect(mocks.createLedger).toHaveBeenCalledTimes(2);
  });
  it('POST transition：非法转换 400 透传；参数错 400；成功 200', async () => {
    mocks.transitionLedger.mockRejectedValueOnce(httpError(400, 'ILLEGAL_TRANSITION')).mockResolvedValueOnce({ ledger: { stage: 2 }, event: { id: 1 } });
    let r = reqRes({ id: ID }, {}, { to_stage: 4, actor: 'rule', reason: '跳级' }); await handler('post', '/factory/ledger/:id/transition')(r.req, r.res);
    expect(r.res._status).toBe(400); expect(r.res._data.code).toBe('ILLEGAL_TRANSITION');
    r = reqRes({ id: ID }, {}, { to_stage: 2, actor: 'human', reason: '人工改' }); await handler('post', '/factory/ledger/:id/transition')(r.req, r.res);
    expect(r.res._status).toBe(200); expect(r.res._data.ledger.stage).toBe(2);
    r = reqRes({ id: ID }, {}, { to_stage: 2, actor: 'nobody', reason: 'x' }); await handler('post', '/factory/ledger/:id/transition')(r.req, r.res);
    expect(r.res._status).toBe(400); expect(mocks.transitionLedger).toHaveBeenCalledTimes(2);
  });
  it('POST runs：记一次运行；PATCH 不许改 stage', async () => {
    mocks.recordRun.mockResolvedValue({ ledger: { recent_pass: 1, recent_total: 1 }, duplicate: false });
    let r = reqRes({ id: ID }, {}, { run_id: 'r1', pass: true }); await handler('post', '/factory/ledger/:id/runs')(r.req, r.res);
    expect(r.res._data.ledger.recent_total).toBe(1);
    r = reqRes({ id: ID }, {}, { stage: 5 }); await handler('patch', '/factory/ledger/:id')(r.req, r.res);
    expect(r.res._status).toBe(400); expect(mocks.patchLedger).not.toHaveBeenCalled();
  });
});
