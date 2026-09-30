import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

let routes;
const AB1 = '11111111-1111-4111-8111-111111111111';
const AB2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
    routes = (await import('../okr-hierarchy.js')).default;
  });
  beforeEach(() => mockPool.query.mockReset());

  it('正常 join：abilities 带 thickness + advancement 聚合', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: [AB1, AB2] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: AB1, name: '抖音发布', thickness: 'medium', status: 'working', done: '2', doing: '1', todo: '3' },
        { ability_id: AB2, name: '快手发布', thickness: 'thin', status: 'planned', done: '0', doing: '0', todo: '0' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.success).toBe(true);
    expect(res._data.kr_title).toBe('KR一');
    expect(res._data.abilities).toHaveLength(2);
    expect(res._data.abilities[0]).toMatchObject({
      ability_id: AB1, thickness: 'medium',
      advancement: { done: 2, doing: 1, todo: 3, total: 6, pct: 33 },
    });
    expect(res._data.missing_ability_ids).toEqual([]);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toContain('journey_features');
    expect(sql).toContain('advancement_items');
    expect(sql).toContain("kind = 'ability'");
    expect(params).toEqual([[AB1, AB2]]);
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

  it('失联 ability id（格式合法但库里查无此人）→ 归入 missing_ability_ids', async () => {
    const missingUuid = '22222222-2222-4222-8222-222222222222';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: [AB1, missingUuid] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: AB1, name: '抖音发布', thickness: 'thin', status: 'working', done: '0', doing: '0', todo: '1' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._data.missing_ability_ids).toEqual([missingUuid]);
  });

  it('格式非法的 ability id 不进 SQL 参数，直接归入 missing_ability_ids', async () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'kr1', title: 'KR一', metadata: { target_abilities: [validUuid, 'ghost'] } }] })
      .mockResolvedValueOnce({ rows: [
        { ability_id: validUuid, name: '抖音发布', thickness: 'thin', status: 'working', done: '0', doing: '0', todo: '1' },
      ] });
    const handler = getHandler('get', '/kr/:id/ability-progress');
    const { req, res } = mockReqRes({}, { id: 'kr1' });
    await handler(req, res);
    expect(res._status).toBe(200);
    expect(res._data.success).toBe(true);
    const [, params] = mockPool.query.mock.calls[1];
    expect(params).toEqual([[validUuid]]);
    expect(res._data.missing_ability_ids).toContain('ghost');
    expect(res._data.abilities).toHaveLength(1);
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

// mountCrud(/projects) 曾计划改指向 projects 表（titleField=name），brain-integration 真库实测
// 发现 okr_scopes/okr_initiatives 仍 FK 指向 okr_projects，改指向会导致 POST /scopes 全部
// 23503；已改回 okr_projects（不变），故不再需要 name 列相关用例——见 okr-hierarchy.js 顶部注释。

// ─── GET /current：KR 下附 projects 数组（棒5，决策 ee4842a6/3feeae3e） ──────────────
describe('GET /current（KR 下附 projects: [{id,name,status,progress,task_total,task_done}]）', () => {
  beforeEach(() => mockPool.query.mockReset());

  it('有 project 的 KR 附带 projects 数组，无 project 的 KR 为空数组', async () => {
    const objRow = { id: 'obj-1', title: 'Objective 1', status: 'active', description: null };
    const krWithProj = { id: 'kr-1', title: 'KR 1', current_value: 0, target_value: 100, unit: '%', status: 'active', progress_pct: 50 };
    const krNoProj = { id: 'kr-2', title: 'KR 2', current_value: 0, target_value: 100, unit: '%', status: 'active', progress_pct: 0 };

    mockPool.query
      .mockResolvedValueOnce({ rows: [objRow] }) // objectives
      .mockResolvedValueOnce({ rows: [krWithProj, krNoProj] }) // key_results for obj-1
      .mockResolvedValueOnce({ // getProjectsForKrBatch: projects
        rows: [
          { id: 'p1', name: 'Project 1', status: 'active', kr_id: 'kr-1' },
          { id: 'p2', name: 'Project 2', status: 'completed', kr_id: 'kr-1' },
        ],
      })
      .mockResolvedValueOnce({ // getProjectsForKrBatch: task stats
        rows: [{ project_id: 'p1', total: 4, done: 3 }],
      });

    const handler = getHandler('get', '/current');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data.success).toBe(true);
    const [obj] = res._data.objectives;
    const krWithProjResult = obj.key_results.find((kr) => kr.id === 'kr-1');
    const krNoProjResult = obj.key_results.find((kr) => kr.id === 'kr-2');

    expect(krWithProjResult.projects).toHaveLength(2);
    const p1 = krWithProjResult.projects.find((p) => p.id === 'p1');
    expect(p1).toMatchObject({ id: 'p1', name: 'Project 1', status: 'active', task_total: 4, task_done: 3, progress: 75 });
    const p2 = krWithProjResult.projects.find((p) => p.id === 'p2');
    expect(p2).toMatchObject({ id: 'p2', status: 'completed', task_total: 0, task_done: 0, progress: 100 });

    expect(krNoProjResult.projects).toEqual([]);
  });

  it('没有任何活跃 Objective 时不查 projects，返回空 objectives 数组', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // objectives

    const handler = getHandler('get', '/current');
    const { req, res } = mockReqRes();
    await handler(req, res);

    expect(res._status).toBe(200);
    expect(res._data.objectives).toEqual([]);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});
