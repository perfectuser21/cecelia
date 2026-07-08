import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));
// status.js（warroom.js 依赖 buildPipelineRecord）会 import 其它模块，这里给个安全 mock 避免副作用
vi.mock('./status.js', () => ({ buildPipelineRecord: () => ({}) }), { virtual: false });

let routes;
function mockReqRes(body = {}, params = {}, query = {}) {
  const req = { body, params, query };
  const res = {
    _status: 200, _data: null,
    status(code) { this._status = code; return this; },
    json(data) { this._data = data; return this; },
  };
  return { req, res };
}
function getHandler(method, path) {
  const layers = routes.stack.filter(l => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route.stack[0].handle;
}

describe('GET /warroom/line/:id/advancements', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes/warroom.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('正常返回 items 数组（含 ability_id + ability_name）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'i1', ability_id: 'ab1', ability_name: '抖音发布', title: '登录保活', status: 'done', priority: 'P0', pr_url: 'http://x', created_at: '2026-01-01' },
        { id: 'i2', ability_id: 'ab1', ability_name: '抖音发布', title: '下载', status: 'todo', priority: 'P1', pr_url: null, created_at: '2026-01-02' },
        { id: 'i3', ability_id: 'ab2', ability_name: '视频剪辑', title: '裁剪', status: 'doing', priority: 'P1', pr_url: null, created_at: '2026-01-03' },
      ],
    });
    const handler = getHandler('get', '/line/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'line-05' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.line_id).toBe('line-05');
    expect(Array.isArray(res._data.items)).toBe(true);
    expect(res._data.items).toHaveLength(3);
    expect(res._data.items[0].ability_name).toBe('抖音发布');
    // 传参正确：journey_id 走 $1
    expect(mockPool.query.mock.calls[0][1]).toEqual(['line-05']);
  });

  it('无推进项 → items 空数组（200）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/line/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'line-empty' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.items).toEqual([]);
  });

  it('DB 抛错 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db down'));
    const handler = getHandler('get', '/line/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'line-05' });
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toBeTruthy();
  });
});
