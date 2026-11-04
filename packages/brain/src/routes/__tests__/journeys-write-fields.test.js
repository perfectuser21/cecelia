import { describe, it, expect, beforeEach } from 'vitest';
import { mockQuery, bindFixture } from './journeys-http.fixture.js';

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
    const update = mockQuery.mock.calls.find(([sql]) => /^UPDATE value_streams SET/.test(sql));
    expect(update[0]).toMatch(/home=\$1,domain=\$2,trigger=\$3,endpoint=\$4/);
    expect(update[1]).toEqual(['biz', '智能客服', 't', 'e', 'a0000000-0000-4000-8000-000000000001']);
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
    const res = await request.default(await bindFixture(app)).patch('/api/brain/journey_features/f1').send({ softness: 'soft', group: 'current-group' });
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/softness=\$1,"group"=\$2/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['soft', 'current-group', 'f1']);
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

describe('GET /api/brain/journeys/:id 非法参数', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  async function get(path) {
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use('/api/brain', router);
    const request = await import('supertest');
    return request.default(await bindFixture(app)).get(path);
  }

  it('非法 id → 400 固定文案，不查库、不泄露数据库原文', async () => {
    const res = await get('/api/brain/journeys/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid journey id: must be a UUID');
    expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('合法但不存在的 uuid → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await get('/api/brain/journeys/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not found');
  });

  it('查库抛错 → 500，响应体不含错误原文', async () => {
    mockQuery.mockRejectedValueOnce(new Error('boom db detail'));
    const res = await get('/api/brain/journeys/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('boom db detail');
  });
});
