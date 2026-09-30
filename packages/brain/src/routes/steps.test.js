/**
 * GET /api/brain/steps、GET /api/brain/enablers 只读路由（价值流建模⑤，任务 741cdf5a）。
 * sync-step-probes 靠它们把 YAML 里的 target:{type,key} 解析成 target_id。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

let routes;
function mockReqRes(query = {}) {
  const req = { body: {}, params: {}, query };
  const res = {
    _status: 200, _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}
function handler(method, path) {
  const layer = routes.stack.find((l) => l.route && l.route.methods[method] && l.route.path === path);
  if (!layer) throw new Error(`No handler for ${method} ${path}`);
  return layer.route.stack.at(-1).handle;
}

beforeAll(async () => {
  vi.resetModules();
  routes = (await import('./steps.js')).default;
});
beforeEach(() => mockPool.query.mockReset());

describe('GET /api/brain/steps', () => {
  it('?key= 精确取一步（参数化）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 's1', key: 'keyword_acquisition.collection.return_to_results' }] });
    const { req, res } = mockReqRes({ key: 'keyword_acquisition.collection.return_to_results' });
    await handler('get', '/steps')(req, res);
    expect(res._status).toBe(200);
    expect(res._data.steps).toHaveLength(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM steps/);
    expect(sql).toMatch(/key = \$1/);
    expect(params).toEqual(['keyword_acquisition.collection.return_to_results']);
  });

  it('?activity_id= 非 uuid → 400', async () => {
    const { req, res } = mockReqRes({ activity_id: 'nope' });
    await handler('get', '/steps')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('无过滤 → 只出 active，按 activity_id, step_order', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({});
    await handler('get', '/steps')(req, res);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/active = true/);
    expect(sql).toMatch(/ORDER BY activity_id, step_order/);
  });
});

describe('GET /api/brain/enablers', () => {
  it('?key= 精确取一个使能件', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'e1', key: 'return_to_results' }] });
    const { req, res } = mockReqRes({ key: 'return_to_results' });
    await handler('get', '/enablers')(req, res);
    expect(res._status).toBe(200);
    expect(res._data.enablers).toHaveLength(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM enablers/);
    expect(params).toEqual(['return_to_results']);
  });
});
