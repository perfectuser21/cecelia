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
    expect(sql).toMatch(/FROM warehouse_items/);
    expect(params).toEqual(['return_to_results']);
  });

  // 技能工厂故障处置表（决策 1b469079）：运行时按依赖对象取片，要读到货架与 failure_semantics
  it('返回 shelf 与 failure_semantics 两列', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({});
    await handler('get', '/enablers')(req, res);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/\bshelf\b/);
    expect(sql).toMatch(/\bfailure_semantics\b/);
  });

  it('?keys=a,b 一次取多件（ANY 参数化）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({ keys: 'device_lock, network ,' });
    await handler('get', '/enablers')(req, res);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/key = ANY\(\$1\)/);
    expect(params).toEqual([['device_lock', 'network']]);
  });
});

describe('PATCH /api/brain/enablers/:key — 写故障处置', () => {
  const valid = {
    failure_semantics: {
      rows: [
        { symptom: '目标暂时没出来', class: 'retryable', wait_s: 5, retries: 3, before_retry: '下拉刷新', then: '按真的没有处理' },
        { symptom: '页面写着暂无结果', class: 'empty_ok' },
      ],
    },
  };

  it('合法 → UPDATE warehouse_items SET failure_semantics 并返回该行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ key: 'douyin_search', failure_semantics: valid.failure_semantics }] });
    const { req, res } = mockReqRes({});
    req.params = { key: 'douyin_search' };
    req.body = valid;
    await handler('patch', '/enablers/:key')(req, res);
    expect(res._status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE warehouse_items\s+SET failure_semantics = \$1::jsonb/);
    expect(sql).toMatch(/updated_at = NOW\(\)/);
    expect(sql).toMatch(/WHERE key = \$2/);
    expect(sql).toMatch(/RETURNING/);
    expect(JSON.parse(params[0])).toEqual(valid.failure_semantics);
    expect(params[1]).toBe('douyin_search');
  });

  it('分类不在四类里 → 400，不写库', async () => {
    const { req, res } = mockReqRes({});
    req.params = { key: 'douyin_search' };
    req.body = { failure_semantics: { rows: [{ symptom: 'x', class: 'maybe' }] } };
    await handler('patch', '/enablers/:key')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('缺 rows 数组或 symptom 为空 → 400', async () => {
    for (const body of [{ failure_semantics: {} }, { failure_semantics: { rows: [{ class: 'fatal', symptom: '' }] } }, {}]) {
      const { req, res } = mockReqRes({});
      req.params = { key: 'k' };
      req.body = body;
      await handler('patch', '/enablers/:key')(req, res);
      expect(res._status).toBe(400);
    }
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('key 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({});
    req.params = { key: 'nope' };
    req.body = valid;
    await handler('patch', '/enablers/:key')(req, res);
    expect(res._status).toBe(404);
  });

  it('写接口挂了内部鉴权中间件', () => {
    const layer = routes.stack.find((l) => l.route && l.route.path === '/enablers/:key' && l.route.methods.patch);
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/brain/activity_uses', () => {
  it('?activity_id= 取该 Activity 依赖的仓库物件（带 key 与 failure_semantics）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ item_key: 'device_lock', role: 'uses' }] });
    const id = '11111111-2222-3333-4444-555555555555';
    const { req, res } = mockReqRes({ activity_id: id });
    await handler('get', '/activity_uses')(req, res);
    expect(res._status).toBe(200);
    expect(res._data.uses).toHaveLength(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM activity_uses/);
    expect(sql).toMatch(/JOIN warehouse_items/);
    expect(sql).toMatch(/failure_semantics/);
    expect(sql).toMatch(/activity_id = \$1/);
    expect(params).toEqual([id]);
  });

  it('activity_id 缺失或非 uuid → 400', async () => {
    for (const q of [{}, { activity_id: 'x' }]) {
      const { req, res } = mockReqRes(q);
      await handler('get', '/activity_uses')(req, res);
      expect(res._status).toBe(400);
    }
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
