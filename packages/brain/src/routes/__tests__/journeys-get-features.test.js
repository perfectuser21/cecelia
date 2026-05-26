import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/journey_features', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { default: router } = await import('../journeys.js');
    const express = await import('express');
    app = express.default();
    app.use(express.default.json());
    app.use('/api/brain', router);
  });

  it('不带参数返回全部 features（200 + array）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'f1', name: 'feat1', journey_id: 'j1', thickness: 'thin' }],
    });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('f1');
  });

  it('按 journey_id 过滤 — SQL 收到 journey_id 参数', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'f2', name: 'feat2', journey_id: 'jj-uuid', thickness: 'medium' }],
    });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features?journey_id=jj-uuid');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toContain('jj-uuid');
  });

  it('DB 报错时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features');
    expect(res.status).toBe(500);
  });
});
