import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery, connect: async () => ({
  query: async (sql, values) => /^(BEGIN|COMMIT|ROLLBACK|LOCK TABLE)/.test(sql)
    ? { rows: [] } : sql.includes('AS organization FROM journeys')
      ? { rows: [{ organization: { gaps: [] } }] } : mockQuery(sql, values),
  release() {},
}) } }));

it('HTTP fixture 的监听地址与 Supertest 请求的 IPv4 地址一致', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const { default: router } = await import('../journeys.js');
  const express = await import('express');
  const app = express.default();
  app.use('/api/brain', router);
  const request = await import('supertest');
  const probe = request.default(await bindFixture(app)).get('/api/brain/journey_steps');
  const address = probe.app.address();
  const res = await probe;
  expect(address.address).toBe('127.0.0.1');
  expect(res.status).toBe(200);
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

const fixtureServers = new Set();

afterEach(async () => {
  try {
    await Promise.all([...fixtureServers].map((server) => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  } finally {
    fixtureServers.clear();
  }
});

async function bindFixture(app) {
  // Supertest requests IPv4 even if an implicit listener picked IPv6.
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  fixtureServers.add(server);
  return server;
}

describe('POST /api/brain/journeys', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 journeys 表，notion_synced_at=NULL，返回行', async () => {
    const fakeRow = {
      id: 'uuid-1234',
      name: 'Test Journey',
      journey_type: 'dev_pipeline',
      notion_synced_at: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journeys')
      .send({ name: 'Test Journey', journey_type: 'dev_pipeline' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('uuid-1234');
    expect(res.body.notion_synced_at).toBeNull();
  });

  it('name 缺失时返回 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journeys')
      .send({ journey_type: 'dev_pipeline' });

    expect(res.status).toBe(400);
  });

  it('journey_type 非法值返回 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journeys')
      .send({ name: 'X', journey_type: 'invalid_type' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/brain/issues', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 issues 表，notion_synced_at=NULL，返回行', async () => {
    const fakeRow = { id: 'issue-uuid', title: 'Bug', priority: 'P2', notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/issues')
      .send({ title: 'Bug', priority: 'P2' });

    expect(res.status).toBe(201);
    expect(res.body.notion_synced_at).toBeNull();
  });

  it('传入 journey_id → SQL 含 journey_id 列且参数传递正确', async () => {
    const fakeRow = { id: 'issue-j', title: 'Bug with journey', priority: 'P1', journey_id: 'j-line04', notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/issues')
      .send({ title: 'Bug with journey', priority: 'P1', journey_id: 'j-line04' });

    expect(res.status).toBe(201);
    expect(res.body.journey_id).toBe('j-line04');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/journey_id/);
    expect(params).toContain('j-line04');
  });

  it('不传 journey_id → SQL 仍传 null（不报错）', async () => {
    const fakeRow = { id: 'issue-nj', title: 'Bug no journey', priority: 'P2', journey_id: null, notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/issues')
      .send({ title: 'Bug no journey' });

    expect(res.status).toBe(201);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain(null);
  });
});

describe('POST /api/brain/journey_features', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 journey_features，notion_synced_at=NULL', async () => {
    const fakeRow = { id: 'feat-uuid', name: 'Feature A', thickness: 'thin', notion_synced_at: null };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'Feature A', thickness: 'thin' });

    expect(res.status).toBe(201);
    expect(res.body.notion_synced_at).toBeNull();
  });
});

describe('POST /journey_features 出生即焊校验', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('status=working 且无锚点 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'Feature X', status: 'working' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('锚点');
  });

  it('status=working 带 guard_ref → 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature X', status: 'working' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'Feature X', status: 'working', guard_ref: 'script:foo.ts' });

    expect(res.status).toBe(201);
  });

  it('status 不传(默认 planned)且无锚点 → 201(骨架阶段不强制)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature Y' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'Feature Y' });

    expect(res.status).toBe(201);
  });

  it('status=planned 显式传入且无锚点 → 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature Z' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'Feature Z', status: 'planned' });

    expect(res.status).toBe(201);
  });
});

describe('GET /api/brain/journeys (list)', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('returns 200 with array of journeys', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'abc', name: 'Test Journey' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journeys');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/brain/journey_steps', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('returns 200 with array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_steps');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/brain/journey_steps', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  async function postStep(body) {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
    const request = await import('supertest');
    return request.default(await bindFixture(app)).post('/api/brain/journey_steps').send(body);
  }

  it('该序号已有步骤：更新它（位置在流程引用里，不写 journey_id / step_number）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ activity_id: 'a1' }] })            // 按能力+槽位找已有引用
      .mockResolvedValueOnce({ rows: [{ id: 'a1', name: 'Step 1' }] });    // UPDATE activities
    const res = await postStep({ journey_id: 'j1', name: 'Step 1', step_number: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'a1', journey_id: 'j1', step_number: 1 });
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM workflow_activity_refs r JOIN workflows w[\s\S]*w\.capability_id = \$1 AND r\.slot_key = \$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['j1', 'step_1']);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE activities SET/);
  });

  it('该序号没有步骤：放进能力的主线流程（恰好一个流程就用它），新建 Activity 与引用，不写旧列', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                           // 无已有引用
      .mockResolvedValueOnce({ rows: [{ id: 'w1', key: 'only_flow' }] })              // 能力下恰好一个流程
      .mockResolvedValueOnce({ rows: [{ id: 'a2', name: 'n' }] })                    // INSERT activities
      .mockResolvedValueOnce({ rows: [] });                                          // INSERT 引用
    const res = await postStep({ journey_id: 'j1', name: 'n', step_number: 3, promise: 'p' });
    expect(res.status).toBe(200);
    const insertActivity = mockQuery.mock.calls[2][0];
    expect(insertActivity).toMatch(/INSERT INTO activities \(name, description, status, promise, backbone_version, notion_synced_at\)/);
    expect(insertActivity).not.toMatch(/journey_id|step_number/);
    expect(mockQuery.mock.calls[3][0]).toMatch(/INSERT INTO workflow_activity_refs/);
    expect(mockQuery.mock.calls[3][1]).toEqual(['w1', 'step_3', 'a2', 3]);
  });

  it('能力下没有流程或有多个流程且没有主线：新建 gp_steps 主线流程再放', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'w1', key: 'a' }, { id: 'w2', key: 'b' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'wNew' }] })                             // INSERT workflows
      .mockResolvedValueOnce({ rows: [{ id: 'a3' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await postStep({ journey_id: 'abcdef12-0000-4000-8000-000000000000', name: 'n', step_number: 1 });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[2][0]).toMatch(/INSERT INTO workflows/);
    expect(mockQuery.mock.calls[2][1][1]).toBe('gp_steps_abcdef12');
    expect(mockQuery.mock.calls[4][1][0]).toBe('wNew');
  });

  it('能力不存在（外键失败）→ 404', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    expect((await postStep({ journey_id: 'ghost', name: 'n', step_number: 1 })).status).toBe(404);
  });

  it('returns 400 when required fields missing', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).post('/api/brain/journey_steps').send({ name: 'Step 1' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/brain/journey_step_links', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('returns 200 with array', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_step_links');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/brain/journey_step_links', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('creates a link and returns 201', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'lnk1', journey_id: 'j1', step_id: 's1', step_order: 1 }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', step_order: 1 });
    expect(res.status).toBe(201);
  });

  it('returns 400 when required fields missing', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).post('/api/brain/journey_step_links').send({ journey_id: 'j1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /journey_step_links cell 化', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('legacy 行 upsert 用 partial index 冲突目标', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', step_order: 1 });

    expect(res.status).toBe(201);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL');
  });

  it('base_ref 格子已退役 → 400，指向 POST /activity_uses，不碰库', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'base_ref', cell_key: 'CRM 表底座', feature_id: 'f1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('activity_uses');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('cell 行走 cell 冲突目标且必须带 cell_key', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');

    const bad = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'capability' });
    expect(bad.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();

    // step 存在性 + journey_id 一致性校验查询
    mockQuery.mockResolvedValueOnce({ rows: [{ journey_id: 'j1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'y' }] });
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 's1', cell_kind: 'scenario', cell_key: '断网重启',
        cell_status: 'pending',
      });
    expect(res.status).toBe(201);
    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('ON CONFLICT (step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL');
  });

  it('journey_id 与 step 实际所属 journey 不一致 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    mockQuery.mockResolvedValueOnce({ rows: [{ journey_id: 'j-other' }] });
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 's1', cell_kind: 'scenario', cell_key: '断网重启',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/journey_id does not match/);
  });

  it('cell 行引用的 step 不存在 → 404', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 'ghost', cell_kind: 'scenario', cell_key: '断网重启',
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('step not found');
  });
});

describe('GET /journey_step_links cell 行过滤', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('默认排除格子行（cell_kind IS NULL）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_step_links');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('cell_kind IS NULL');
  });

  it('cells=1 时只返回格子行（cell_kind IS NOT NULL），可叠加 cell_kind 精筛', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_step_links?cells=1&cell_kind=base_ref');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('cell_kind IS NOT NULL');
    expect(sql).toContain('cell_kind=');
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain('base_ref');
  });
});

describe('GET /journey_features/:id/blast-radius', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('返回 feature + 引用步骤清单', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'CRM 表底座', status: 'building', group: '家③横切件池' }] })
      .mockResolvedValueOnce({ rows: [{ journey_id: 'j1', journey_name: 'GP-B', domain: '智能客服', step_id: 's1', step_name: '决定谁来答', step_number: 2, promise: 'x', cell_status: 'pending' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_features/f1/blast-radius');
    expect(res.status).toBe(200);
    expect(res.body.feature.name).toBe('CRM 表底座');
    expect(res.body.count).toBe(1);
    expect(res.body.blast_radius[0].promise).toBe('x');
    const radiusSql = mockQuery.mock.calls[1][0];
    expect(radiusSql).toContain('activity_uses');
    expect(radiusSql).toContain('legacy_feature_id');
    expect(radiusSql).not.toContain("base_ref");
  });

  it('feature 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_features/nope/blast-radius');
    expect(res.status).toBe(404);
  });
});

describe('POST /activity_uses（用料登记，取代底座格子）', () => {
  beforeEach(() => { mockQuery.mockReset(); });
  const ACT = 'c1000000-0000-4000-8000-000000000001';
  const ITEM = 'd1000000-0000-4000-8000-000000000001';
  async function post(body) {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
    const request = await import('supertest');
    return request.default(await bindFixture(app)).post('/api/brain/activity_uses').send(body);
  }

  it('按 item_key 登记：先查物件，再按 (activity_id, item_id) 幂等写入', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: ITEM }] }).mockResolvedValueOnce({ rows: [{ id: 'u1', activity_id: ACT, item_id: ITEM, role: 'depends' }] });
    const res = await post({ activity_id: ACT, item_key: 'crm_table', role: 'depends', assertion_ref: 'tests/crm.test.js' });
    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM warehouse_items WHERE key = \$1/);
    const sql = mockQuery.mock.calls[1][0];
    expect(sql).toContain('INSERT INTO activity_uses');
    expect(sql).toContain('ON CONFLICT (activity_id, item_id) DO UPDATE');
    expect(mockQuery.mock.calls[1][1]).toEqual([ACT, ITEM, 'depends', 'tests/crm.test.js', null]);
    expect(res.body.id).toBe('u1');
  });

  it('item_id 直接给 uuid：不再查物件；角色默认 uses', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2' }] });
    const res = await post({ activity_id: ACT, item_id: ITEM });
    expect(res.status).toBe(201);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1].slice(0, 3)).toEqual([ACT, ITEM, 'uses']);
  });

  it('参数不合法 → 400，不碰库：activity_id 非 uuid / 角色不在 uses|depends|produces / item 两个都没给 / 状态不在 gray|red|pending|green', async () => {
    for (const body of [
      { activity_id: 'x', item_id: ITEM }, { activity_id: ACT, item_id: ITEM, role: 'owns' },
      { activity_id: ACT }, { activity_id: ACT, item_id: ITEM, cell_status: 'blue' },
    ]) expect((await post(body)).status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('物件不存在 → 404；活动不存在（外键冲突）→ 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await post({ activity_id: ACT, item_key: 'nope' })).status).toBe(404);
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    expect((await post({ activity_id: ACT, item_id: ITEM })).status).toBe(404);
  });
});

describe('PATCH /journeys/:id 承诺地图字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('白名单更新 home/domain/trigger/endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a0000000-0000-4000-8000-000000000001', parent_journey_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'a0000000-0000-4000-8000-000000000001', home: 'biz' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .patch('/api/brain/journeys/a0000000-0000-4000-8000-000000000001')
      .send({ home: 'biz', domain: '智能客服', trigger: 't', endpoint: 'e' });
    expect(res.status).toBe(200);
  });

  it('home 非法值 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).patch('/api/brain/journeys/j1').send({ home: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /journey_features/:id softness/group', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('softness 白名单', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', softness: 'soft' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).patch('/api/brain/journey_features/f1').send({ softness: 'soft' });
    expect(res.status).toBe(200);
  });

  it('softness 非法值 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).patch('/api/brain/journey_features/f1').send({ softness: 'fuzzy' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /journey_features/:id workflow_ref', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('workflow_ref 写入 UPDATE 语句', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', workflow_ref: 'e2e/foo.spec.ts' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .patch('/api/brain/journey_features/f1')
      .send({ workflow_ref: 'e2e/foo.spec.ts' });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toContain('workflow_ref');
    expect(mockQuery.mock.calls[0][1]).toContain('e2e/foo.spec.ts');
  });

  it('workflow_ref 传 null 会清空字段', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', workflow_ref: null }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .patch('/api/brain/journey_features/f1')
      .send({ workflow_ref: null });

    expect(res.status).toBe(200);
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toContain('workflow_ref');
  });
});

describe('POST /journey_steps promise', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('更新与新建都带 promise/backbone_version', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
    const request = await import('supertest');
    const post = async () => request.default(await bindFixture(app)).post('/api/brain/journey_steps').send({ journey_id: 'j1', name: 'n', step_number: 1, promise: 'p', backbone_version: '3.0' });

    mockQuery.mockResolvedValueOnce({ rows: [{ activity_id: 'a1' }] }).mockResolvedValueOnce({ rows: [{ id: 'a1' }] });
    expect((await post()).status).toBe(200);
    const update = mockQuery.mock.calls[1];
    expect(update[0]).toMatch(/promise=COALESCE\(\$4, promise\)[\s\S]*backbone_version=COALESCE\(\$5, backbone_version\)/);
    expect(update[1]).toEqual(['a1', 'n', null, 'p', '3.0']);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'w1', key: 'k' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a2' }] }).mockResolvedValueOnce({ rows: [] });
    expect((await post()).status).toBe(200);
    expect(mockQuery.mock.calls[2][0]).toContain('promise');
    expect(mockQuery.mock.calls[2][1]).toEqual(['n', null, 'planned', 'p', '3.0']);
  });
});

describe('GET /journey_features kind 过滤', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('kind 参数传入 SQL WHERE 子句', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_features?kind=ability');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('kind=');
    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain('ability');
  });
});

describe('POST /journey_features kind 和 workflow_ref 写入', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('kind 字段写入 INSERT 语句', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // journey_id lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'feat-1', name: 'test-feature', kind: 'ability', workflow_ref: null }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app))
      .post('/api/brain/journey_features')
      .send({ name: 'test-feature', kind: 'ability' });
    expect(res.status).toBe(201);
    const insertSql = mockQuery.mock.calls.find(c => c[0].includes('INSERT'));
    expect(insertSql[0]).toContain('kind');
    expect(insertSql[0]).toContain('workflow_ref');
  });
});

describe('GET /journey_features/:id', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('按 id 精确取单行', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Feature A', unit_test_path: null, workflow_ref: null, guard_ref: null }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_features/f1');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('f1');
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('WHERE id=$1');
  });

  it('不存在的 id → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_features/nope');

    expect(res.status).toBe(404);
  });
});
