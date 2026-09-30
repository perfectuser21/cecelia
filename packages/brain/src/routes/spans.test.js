/**
 * POST/GET /api/brain/spans（价值流建模④，任务 ec643d60，决策 3e867cad）。
 * pool 全 mock；断言：校验 400（run_id / started_at / executor_kind / outcome / 至少一个目标）、
 * 单条与数组批量都走 ON CONFLICT DO NOTHING 且回报 inserted/skipped、GET 必带 run_id。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

let routes;
function mockReqRes(body = {}, query = {}) {
  const req = { body, params: {}, query, headers: {}, ip: '127.0.0.1' };
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

const ACT = 'c1000000-0000-4000-8000-000000000001';
const STEP = 'd1000000-0000-4000-8000-000000000001';
const GOOD = {
  run_id: 'social-keyword-leadgen-crontab-auto09300930__a1.collection',
  activity_id: ACT,
  started_at: '2026-09-30T14:00:00Z',
  ended_at: '2026-09-30T14:00:03Z',
  executor_kind: 'code',
  executor_id: 'xian-m4',
  attempts: 2,
  fallback: true,
  outcome: 'pass',
};

beforeAll(async () => {
  vi.resetModules();
  routes = (await import('./spans.js')).default;
});

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('POST /spans', () => {
  it('单条：插入走 ON CONFLICT DO NOTHING，回报 inserted=1 skipped=0', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'e1000000-0000-4000-8000-000000000001' }], rowCount: 1 });
    const { req, res } = mockReqRes(GOOD);
    await handler('post', '/spans')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toMatchObject({ inserted: 1, skipped: 0, count: 1 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO spans/);
    expect(sql).toMatch(/ON CONFLICT \(run_id, \(COALESCE\(step_id, activity_id, enabler_id\)\), started_at\) DO NOTHING/);
    expect(sql).toMatch(/RETURNING id/);
    expect(params[0]).toBe(GOOD.run_id);
    expect(params).toContain(ACT);
    expect(params).toContain('code');
    expect(params).toContain('pass');
  });

  it('数组批量：每条一次 INSERT；重复行 rowCount=0 计为 skipped', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { req, res } = mockReqRes([GOOD, { ...GOOD, step_id: STEP, activity_id: undefined }]);
    await handler('post', '/spans')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toMatchObject({ inserted: 1, skipped: 1, count: 2 });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('缺 run_id / started_at 非法 / executor_kind 非法 / outcome 非法 / 没有任何目标 → 400 不查库', async () => {
    const bad = [
      { ...GOOD, run_id: '' },
      { ...GOOD, started_at: 'yesterday' },
      { ...GOOD, executor_kind: 'robot' },
      { ...GOOD, outcome: 'meh' },
      { ...GOOD, activity_id: undefined },
      { ...GOOD, activity_id: 'not-a-uuid' },
    ];
    for (const body of bad) {
      const { req, res } = mockReqRes(body);
      await handler('post', '/spans')(req, res);
      expect(res._status, JSON.stringify(body)).toBe(400);
      expect(res._data.error).toBeTruthy();
    }
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('空数组 → 400；outcome 缺省为 unknown、attempts 缺省 1、fallback 缺省 false', async () => {
    const { req: r0, res: s0 } = mockReqRes([]);
    await handler('post', '/spans')(r0, s0);
    expect(s0._status).toBe(400);
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'e1' }], rowCount: 1 });
    const { req, res } = mockReqRes({ run_id: 'r', activity_id: ACT, started_at: GOOD.started_at, executor_kind: 'agent' });
    await handler('post', '/spans')(req, res);
    expect(res._status).toBe(200);
    const [, params] = mockPool.query.mock.calls[0];
    expect(params).toContain('unknown');
    expect(params).toContain(1);
    expect(params).toContain(false);
  });

  it('库错误 → 500 带 error', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('boom'));
    const { req, res } = mockReqRes(GOOD);
    await handler('post', '/spans')(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toMatch(/boom/);
  });
});

describe('GET /spans', () => {
  it('run_id 必填 → 缺则 400 不查库', async () => {
    const { req, res } = mockReqRes({}, {});
    await handler('get', '/spans')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('按 run_id 查，activity_id 可选过滤，按 started_at 排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'e1', run_id: GOOD.run_id }] });
    const { req, res } = mockReqRes({}, { run_id: GOOD.run_id, activity_id: ACT });
    await handler('get', '/spans')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toEqual({ spans: [{ id: 'e1', run_id: GOOD.run_id }], total: 1 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM spans/);
    expect(sql).toMatch(/run_id = \$1/);
    expect(sql).toMatch(/activity_id = \$2/);
    expect(sql).toMatch(/ORDER BY started_at/);
    expect(params).toEqual([GOOD.run_id, ACT]);
  });

  it('activity_id 非法 uuid → 400', async () => {
    const { req, res } = mockReqRes({}, { run_id: 'r', activity_id: 'nope' });
    await handler('get', '/spans')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
