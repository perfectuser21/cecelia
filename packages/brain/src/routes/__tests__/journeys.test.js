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
