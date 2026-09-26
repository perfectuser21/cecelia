import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import { specHash } from '../lib/step-probe-spec.js';

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
function route(method, path) {
  const layers = routes.stack.filter(l => l.route && l.route.methods[method] && l.route.path === path);
  if (layers.length === 0) throw new Error(`No handler for ${method} ${path}`);
  return layers[0].route;
}
const lastHandler = (method, path) => route(method, path).stack.at(-1).handle;

const WORKFLOW = 'social-keyword-leadgen';
const LINK = '97947882-52d7-410d-a503-40c860b63750';
function rawProbe(overrides = {}) {
  return {
    key: 'delivery.leads_count',
    stage: 'delivery',
    journey_cell: 'stage:delivery',
    probe: { type: 'sql', target: 'leadgen_db', query: 'SELECT count(*) AS n FROM leads' },
    expect: { op: '>=', ref: 'metrics.expected_leads' },
    severity: 'error',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.resetModules();
  routes = (await import('./step-probes.js')).default;
});
beforeEach(() => mockPool.query.mockReset());

describe('GET /api/brain/step-probes', () => {
  it('无过滤 → 全量 active 行，按 workflow/stage/probe_key 排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ probe_key: 'a' }] });
    const { req, res } = mockReqRes({}, {}, {});
    await lastHandler('get', '/step-probes')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toEqual({ probes: [{ probe_key: 'a' }], count: 1 });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM step_probes/);
    expect(sql).toMatch(/ORDER BY workflow, stage, probe_key/);
    expect(params).toEqual([]);
  });

  it('?workflow=&stage= 参数化过滤（不拼字符串）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const { req, res } = mockReqRes({}, {}, { workflow: WORKFLOW, stage: 'delivery' });
    await lastHandler('get', '/step-probes')(req, res);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/workflow = \$1/);
    expect(sql).toMatch(/stage = \$2/);
    expect(params).toEqual([WORKFLOW, 'delivery']);
  });

  it('?active=all 才把已下线行带出来，默认只出 active', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await lastHandler('get', '/step-probes')(...Object.values(mockReqRes({}, {}, {})));
    expect(mockPool.query.mock.calls[0][0]).toMatch(/active = true/);
    await lastHandler('get', '/step-probes')(...Object.values(mockReqRes({}, {}, { active: 'all' })));
    expect(mockPool.query.mock.calls[1][0]).not.toMatch(/active = true/);
  });

  it('数据库出错 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db down'));
    const { req, res } = mockReqRes();
    await lastHandler('get', '/step-probes')(req, res);
    expect(res._status).toBe(500);
    expect(res._data.error).toBe('db down');
  });
});

describe('POST /api/brain/step-probes（按 probe_key upsert）', () => {
  it('挂 internalAuthOrLoopback 中间件', () => {
    // vi.resetModules 后中间件是另一份模块实例，按名字比对
    expect(route('post', '/step-probes').stack[0].handle.name).toBe(internalAuthOrLoopback.name);
    expect(route('post', '/step-probes/drift-check').stack[0].handle.name).toBe(internalAuthOrLoopback.name);
  });

  it('新探针 → INSERT ... ON CONFLICT (probe_key) DO UPDATE，回 action=inserted 且 spec_hash=sha256(canonical spec)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // 现有哈希
      .mockResolvedValueOnce({ rows: [{ id: 'p1', probe_key: 'delivery.leads_count', spec_hash: 'x', journey_step_link_id: LINK }] });
    const { req, res } = mockReqRes({ workflow: WORKFLOW, source_path: 'services/x/checks/y.yaml', probes: [{ ...rawProbe(), journey_step_link_id: LINK }] });
    await lastHandler('post', '/step-probes')(req, res);
    expect(res._status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO step_probes/);
    expect(sql).toMatch(/ON CONFLICT \(probe_key\) DO UPDATE/);
    expect(sql).toMatch(/updated_at = now\(\)/);
    // 参数顺序：probe_key, workflow, stage, journey_step_link_id, spec(json), spec_hash, source_path, severity
    expect(params[0]).toBe('delivery.leads_count');
    expect(params[1]).toBe(WORKFLOW);
    expect(params[2]).toBe('delivery');
    expect(params[3]).toBe(LINK);
    const spec = JSON.parse(params[4]);
    expect(spec).not.toHaveProperty('journey_step_link_id');
    expect(params[5]).toBe(specHash(spec));
    expect(params[6]).toBe('services/x/checks/y.yaml');
    expect(params[7]).toBe('error');
    expect(res._data.upserted).toEqual([expect.objectContaining({ probe_key: 'delivery.leads_count', action: 'inserted' })]);
  });

  it('同 spec 再 POST → action=unchanged（幂等，哈希一致不算变更）', async () => {
    const spec = rawProbe();
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [spec] });
    // 先算一次库里的哈希：走一遍 handler 拿 params[5]
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'p1', probe_key: spec.key }] });
    await lastHandler('post', '/step-probes')(req, res);
    const hash = mockPool.query.mock.calls[1][1][5];

    mockPool.query.mockReset();
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ probe_key: spec.key, spec_hash: hash }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', probe_key: spec.key }] });
    const second = mockReqRes({ workflow: WORKFLOW, probes: [spec] });
    await lastHandler('post', '/step-probes')(second.req, second.res);
    expect(second.res._data.upserted[0].action).toBe('unchanged');
  });

  it('spec 变了 → action=updated', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ probe_key: 'delivery.leads_count', spec_hash: '0'.repeat(64) }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', probe_key: 'delivery.leads_count' }] });
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [rawProbe()] });
    await lastHandler('post', '/step-probes')(req, res);
    expect(res._data.upserted[0].action).toBe('updated');
  });

  it('journey_step_link_id 缺省时保留库里已有的绑定（COALESCE）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'p1', probe_key: 'delivery.leads_count' }] });
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [rawProbe()] });
    await lastHandler('post', '/step-probes')(req, res);
    const [sql, params] = mockPool.query.mock.calls[1];
    expect(sql).toMatch(/journey_step_link_id = COALESCE\(EXCLUDED\.journey_step_link_id, step_probes\.journey_step_link_id\)/);
    expect(params[3]).toBeNull();
  });

  it('任一条 spec 非法 → 400 带 code，整批不写库', async () => {
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [rawProbe(), rawProbe({ key: 'bad', severity: 'fatal' })] });
    await lastHandler('post', '/step-probes')(req, res);
    expect(res._status).toBe(400);
    expect(res._data.error.code).toBe('STEP_PROBE_SEVERITY_INVALID');
    expect(res._data.error.probe_key).toBe('bad');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('journey_step_link_id 不是 uuid → 400', async () => {
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [{ ...rawProbe(), journey_step_link_id: 'nope' }] });
    await lastHandler('post', '/step-probes')(req, res);
    expect(res._status).toBe(400);
    expect(res._data.error.code).toBe('STEP_PROBE_LINK_INVALID');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('probes 为空 / 不是数组 → 400', async () => {
    const a = mockReqRes({ workflow: WORKFLOW, probes: [] });
    await lastHandler('post', '/step-probes')(a.req, a.res);
    expect(a.res._status).toBe(400);
    const b = mockReqRes({ workflow: WORKFLOW });
    await lastHandler('post', '/step-probes')(b.req, b.res);
    expect(b.res._status).toBe(400);
  });
});

describe('POST /api/brain/step-probes/drift-check', () => {
  it('库与 YAML 现算哈希比对：changed/missing/extra 分类，drift=true', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [
      { probe_key: 'a', spec_hash: '1'.repeat(64), active: true },
      { probe_key: 'b', spec_hash: '9'.repeat(64), active: true },
      { probe_key: 'z', spec_hash: '5'.repeat(64), active: true },
    ] });
    const { req, res } = mockReqRes({ workflow: WORKFLOW, probes: [
      { key: 'a', spec_hash: '1'.repeat(64) },
      { key: 'b', spec_hash: '2'.repeat(64) },
      { key: 'c', spec_hash: '3'.repeat(64) },
    ] });
    await lastHandler('post', '/step-probes/drift-check')(req, res);
    expect(res._status).toBe(200);
    expect(res._data).toEqual({ workflow: WORKFLOW, drift: true, missing: ['c'], extra: ['z'], changed: ['b'], same: ['a'] });
    expect(mockPool.query.mock.calls[0][1]).toEqual([WORKFLOW]);
  });

  it('缺 workflow 或 probes 形状不对 → 400', async () => {
    const { req, res } = mockReqRes({ probes: [{ key: 'a', spec_hash: 'zz' }] });
    await lastHandler('post', '/step-probes/drift-check')(req, res);
    expect(res._status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
