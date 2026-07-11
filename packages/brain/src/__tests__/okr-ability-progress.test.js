import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

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

describe('GET /kr/:id/ability-progress (T6 两轴对账)', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('../routes/okr-hierarchy.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('正常 join：abilities 带 thickness + advancement 聚合', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: ['ab1', 'ab2'] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: 'ab1', name: '抖音发布', thickness: 'medium', status: 'working', done: '2', doing: '1', todo: '3' },
        { ability_id: 'ab2', name: '快手发布', thickness: 'thin', status: 'planned', done: '0', doing: '0', todo: '0' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.success).toBe(true);
    expect(res._data.kr_title).toBe('KR一');
    expect(res._data.abilities).toHaveLength(2);
    expect(res._data.abilities[0]).toMatchObject({
      ability_id: 'ab1', thickness: 'medium',
      advancement: { done: 2, doing: 1, todo: 3, total: 6, pct: 33 },
    });
    expect(res._data.missing_ability_ids).toEqual([]);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toContain('journey_features');
    expect(sql).toContain('advancement_items');
    expect(sql).toContain("kind = 'ability'");
    expect(params).toEqual([['ab1', 'ab2']]);
  });

  it('metadata 无 target_abilities → 空 abilities + hint，不发第二条 SQL', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: null }] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.abilities).toEqual([]);
    expect(res._data.hint).toContain('target_abilities');
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('失联 ability id → 归入 missing_ability_ids', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: ['ab1', 'ghost'] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: 'ab1', name: '抖音发布', thickness: 'thin', status: 'working', done: '0', doing: '0', todo: '1' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._data.missing_ability_ids).toEqual(['ghost']);
  });

  it('KR 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'nope' });
    await handler(req, res);
    expect(res._status).toBe(404);
    expect(res._data.success).toBe(false);
  });
});
