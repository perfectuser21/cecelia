import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/registry — created_at fix', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../registry.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain/registry', router);
  });

  it('SELECT 查询用 created_at 而不是 registered_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry');
    expect(res.status).toBe(200);
    const sqlCall = mockQuery.mock.calls[0][0];
    expect(sqlCall).toContain('created_at');
    expect(sqlCall).not.toContain('registered_at');
  });

  it('type 过滤参数正确传入 SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', name: 'test-api', type: 'api_endpoint' }] });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry?type=api_endpoint');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toContain('api_endpoint');
  });

  it('DB 报错时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/brain/registry?type=skill routing', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../registry.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain/registry', router);
  });

  it('routes type=skill to skill_registry (returns notion_id field)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'abc', notion_id: 'notion-123', name: '/dev', status: 'active' }
    ]});
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry?type=skill&limit=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // skill_registry rows have notion_id field
    expect(res.body[0]).toHaveProperty('notion_id');
    // SQL should query skill_registry, not system_registry
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('skill_registry');
    expect(sql).not.toContain('system_registry');
  });

  it('routes other types to system_registry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'xyz', name: 'my-api', type: 'api', status: 'active' }
    ]});
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/registry?type=api&limit=1');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('system_registry');
    expect(sql).not.toContain('skill_registry');
  });
});

describe('POST /api/brain/registry type=skill guard', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { default: router } = await import('../registry.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain/registry', router);
  });

  it('POST type=skill returns 400 with guidance to use /api/brain/skills', async () => {
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/registry')
      .send({ name: '/dev', type: 'skill' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('/api/brain/skills');
  });

  it('POST other types accepted (mock insert succeeds)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'reg-1', name: 'my-api', type: 'api', status: 'active' }] });
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/registry')
      .send({ name: 'my-api', type: 'api' });
    expect(res.status).toBe(201);
  });
});
