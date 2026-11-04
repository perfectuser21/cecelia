import { describe, it, expect, beforeEach } from 'vitest';
import { mockQuery, bindFixture } from './journeys-http.fixture.js';

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

describe('GET /api/brain/journey_steps 位置过滤（位置由流程引用推出）', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('journey_id 过滤走 activity_placement.capability_id，响应列回显 journey_id / step_number', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', journey_id: 'j1', step_number: 2 }] });
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    const app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
    const request = await import('supertest');
    const res = await request.default(await bindFixture(app)).get('/api/brain/journey_steps?journey_id=j1');
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN activity_placement p ON p\.activity_id = a\.id WHERE p\.capability_id=\$1/);
    expect(sql).toMatch(/p\.capability_id AS journey_id, p\.step_number/);
    expect(params).toEqual(['j1', 100]);
  });
});

