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

describe('GET /api/brain/org-units', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('./org-units.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('单一 company、无 department、无成员 → 一棵只有根节点的树', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'c1', unit_type: 'company', parent_id: null, name: 'Cecelia/ZenithJoy', leader: 'Alex', area_id: null, status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] });
    const handler = getHandler('get', '/org-units');
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.companies).toHaveLength(1);
    expect(res._data.companies[0].id).toBe('c1');
    expect(res._data.companies[0].departments).toEqual([]);
    expect(res._data.companies[0].member_counts).toEqual({ agent: 0, human: 0 });
  });

  it('company 挂 department，department 挂在正确的父节点下', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'c1', unit_type: 'company', parent_id: null, name: 'Cecelia/ZenithJoy', leader: 'Alex', area_id: null, status: 'active' },
          { id: 'd1', unit_type: 'department', parent_id: 'c1', name: '内容部', leader: 'Alex', area_id: 'area-1', status: 'incubating' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ org_unit_id: 'd1', member_type: 'human', count: 2 }] });
    const handler = getHandler('get', '/org-units');
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.companies).toHaveLength(1);
    expect(res._data.companies[0].departments).toHaveLength(1);
    expect(res._data.companies[0].departments[0].id).toBe('d1');
    expect(res._data.companies[0].departments[0].member_counts).toEqual({ agent: 0, human: 2 });
  });

  it('数据库出错 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db down'));
    const handler = getHandler('get', '/org-units');
    const { req, res } = mockReqRes();
    await handler(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toBe('db down');
  });
});

describe('POST /api/brain/org-units/promotion-check', () => {
  beforeAll(async () => {
    vi.resetModules();
    routes = (await import('./org-units.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('不查库，纯转发 evaluateAreaForPromotion 的判定结果', async () => {
    const recentDays = Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${i + 1}`, hasEvidence: true }));
    const handler = getHandler('post', '/org-units/promotion-check');
    const { req, res } = mockReqRes({ area_id: 'area-1', recentDays });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.eligible).toBe(true);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('area_id 缺失 → eligible=false（同 evaluateAreaForPromotion 的判定）', async () => {
    const handler = getHandler('post', '/org-units/promotion-check');
    const { req, res } = mockReqRes({});
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.eligible).toBe(false);
  });
});
