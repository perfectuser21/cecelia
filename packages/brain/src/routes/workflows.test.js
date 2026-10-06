/**
 * GET /api/brain/workflows 只读路由（价值流建模③，任务 ce41cd59，决策 3e867cad）。
 * pool 全 mock；断言 SQL 形状（join capabilities 取 capability 名、activity 计数）、过滤参数、非法 uuid 400。
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
  const layers = routes.stack.filter((l) => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack.at(-1).handle;
}

const CAP = 'a1000000-0000-4000-8000-000000000001';
const ROW = {
  id: 'b1000000-0000-4000-8000-000000000001', key: 'douyin_keyword_leadgen', name: '抖音·关键词获客', channel: 'douyin',
  form: 'android_rpa', version: '1.0', status: 'active', capability_id: CAP, capability_name: '关键词获客',
  value_stream_id: 'afa6abca-53c0-4815-8594-b7fb81ca547f', activity_count: 8,
};

beforeAll(async () => {
  vi.resetModules();
  routes = (await import('./workflows.js')).default;
});

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('GET /workflows', () => {
  it('无过滤：join journeys 取 capability_name / value_stream_id，带 activity_count，按 key 排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    const { req, res } = mockReqRes();
    await handler('get', '/workflows')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toEqual({ workflows: [ROW], total: 1 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM workflows w\s+JOIN capabilities c ON c\.id = w\.capability_id/);
    expect(sql).toMatch(/capability_name/);
    expect(sql).toMatch(/activity_count/);
    expect(sql).toMatch(/ORDER BY w\.key/);
    expect(params).toEqual([]);
  });

  it('capability_id / value_stream_id / status 过滤进 WHERE 与参数', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({ capability_id: CAP, value_stream_id: ROW.value_stream_id, status: 'active' });
    await handler('get', '/workflows')(req, res);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/w\.capability_id = \$1/);
    expect(sql).toMatch(/c\.parent_journey_id = \$2/);
    expect(sql).toMatch(/w\.status = \$3/);
    expect(params).toEqual([CAP, ROW.value_stream_id, 'active']);
    expect(res._data).toEqual({ workflows: [], total: 0 });
  });

  it('非法 uuid → 400，不查库', async () => {
    const { req, res } = mockReqRes({ capability_id: 'not-a-uuid' });
    await handler('get', '/workflows')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('库错误 → 500 带 error', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('boom'));
    const { req, res } = mockReqRes();
    await handler('get', '/workflows')(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toMatch(/boom/);
  });
});
