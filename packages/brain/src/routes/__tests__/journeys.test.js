import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

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
    const res = await request.default(app)
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
    const res = await request.default(app)
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
    const res = await request.default(app)
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
    const res = await request.default(app)
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
    const res = await request.default(app)
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
    const res = await request.default(app)
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
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'Feature A', thickness: 'thin' });

    expect(res.status).toBe(201);
    expect(res.body.notion_synced_at).toBeNull();
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
    const res = await request.default(app).get('/api/brain/journeys');
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
    const res = await request.default(app).get('/api/brain/journey_steps');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/brain/journey_steps', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('creates a step and returns 200 (upsert endpoint)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'xyz', name: 'Step 1', journey_id: 'j1', step_number: 1 }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_steps')
      .send({ journey_id: 'j1', name: 'Step 1', step_number: 1 });
    expect(res.status).toBe(200);
  });

  it('returns 400 when required fields missing', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app).post('/api/brain/journey_steps').send({ name: 'Step 1' });
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
    const res = await request.default(app).get('/api/brain/journey_step_links');
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
    const res = await request.default(app)
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
    const res = await request.default(app).post('/api/brain/journey_step_links').send({ journey_id: 'j1' });
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
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', step_order: 1 });

    expect(res.status).toBe(201);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL');
  });

  it('base_ref 格子缺 feature_id → 400（blast-radius 锚不可缺）', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'base_ref', cell_key: 'CRM 表底座' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('feature_id');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('cell 行走 cell 冲突目标且必须带 cell_key', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');

    const bad = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'capability' });
    expect(bad.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();

    // step 存在性 + journey_id 一致性校验查询
    mockQuery.mockResolvedValueOnce({ rows: [{ journey_id: 'j1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'y' }] });
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 's1', cell_kind: 'base_ref', cell_key: 'CRM 表底座',
        cell_status: 'pending', feature_id: 'f1',
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
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 's1', cell_kind: 'base_ref', cell_key: 'CRM 表底座', feature_id: 'f1',
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
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 'ghost', cell_kind: 'base_ref', cell_key: 'CRM 表底座', feature_id: 'f1',
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
    const res = await request.default(app).get('/api/brain/journey_step_links');
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
    const res = await request.default(app).get('/api/brain/journey_step_links?cells=1&cell_kind=base_ref');
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
    const res = await request.default(app).get('/api/brain/journey_features/f1/blast-radius');
    expect(res.status).toBe(200);
    expect(res.body.feature.name).toBe('CRM 表底座');
    expect(res.body.count).toBe(1);
    expect(res.body.blast_radius[0].promise).toBe('x');
  });

  it('feature 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features/nope/blast-radius');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /journeys/:id 承诺地图字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('白名单更新 home/domain/trigger/endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'j1', home: 'biz' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journeys/j1')
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
    const res = await request.default(app).patch('/api/brain/journeys/j1').send({ home: 'nope' });
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
    const res = await request.default(app).patch('/api/brain/journey_features/f1').send({ softness: 'soft' });
    expect(res.status).toBe(200);
  });

  it('softness 非法值 → 400', async () => {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app).patch('/api/brain/journey_features/f1').send({ softness: 'fuzzy' });
    expect(res.status).toBe(400);
  });
});

describe('POST /journey_steps promise', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('insert+update 都带 promise/backbone_version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] });

    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);

    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_steps')
      .send({ journey_id: 'j1', name: 'n', step_number: 1, promise: 'p' });
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('promise');
    expect(sql).toContain('backbone_version');
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
    const res = await request.default(app).get('/api/brain/journey_features?kind=ability');
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
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'test-feature', kind: 'ability' });
    expect(res.status).toBe(201);
    const insertSql = mockQuery.mock.calls.find(c => c[0].includes('INSERT'));
    expect(insertSql[0]).toContain('kind');
    expect(insertSql[0]).toContain('workflow_ref');
  });
});
