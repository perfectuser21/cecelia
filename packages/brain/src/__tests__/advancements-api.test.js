import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

// 注意：advancement 三 endpoint 挂在 routes/abilities.js 这个 router 上，
// 该 router 在 server.js 直接 app.use('/api/brain', abilitiesRouter)，未汇入 routes.js。
// 因此这里直接导入 abilities.js 的 router 取 handler。
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

describe('advancements API', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes/abilities.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('GET 聚合：ability 存在 → items + progress', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ab1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'done' }, { id: 'i2', status: 'todo' }, { id: 'i3', status: 'todo' }] })
      .mockResolvedValueOnce({ rows: [{ done: '1', doing: '0', todo: '2' }] });
    const handler = getHandler('get', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.progress).toEqual({ done: 1, doing: 0, todo: 2, total: 3, pct: 33 });
    expect(res._data.items).toHaveLength(3);
  });

  it('GET：ability 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
  });

  it('POST：title 缺失 → 400，不查库不插入', async () => {
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({}, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('POST：ability 不存在 → 404，不插入孤儿行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({ title: 'x' }, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('POST：正常 → 201', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ab1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'new', title: 'x', status: 'todo' }] });
    const handler = getHandler('post', '/abilities/:id/advancements');
    const { req, res } = mockReqRes({ title: 'x' }, { id: 'ab1' });
    await handler(req, res);
    expect(res._status).toBe(201);
    expect(res._data.status).toBe('todo');
  });

  it('PATCH：非法 status → 400', async () => {
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'bogus' }, { itemId: 'i1' });
    await handler(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('PATCH：status=done → done_at 联动，返回行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'i1', status: 'done' }] });
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'done', pr_url: 'http://x' }, { itemId: 'i1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toMatch(/done_at=now\(\)/);
  });

  it('PATCH：item 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('patch', '/advancements/:itemId');
    const { req, res } = mockReqRes({ status: 'doing' }, { itemId: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
  });
});
