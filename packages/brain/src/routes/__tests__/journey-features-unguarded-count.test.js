import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/journey_features/unguarded-count', () => {
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

  it('返回裸奔 FR 数（guard_ref IS NULL AND status=live）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 7 }] });
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features/unguarded-count');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/guard_ref IS NULL/);
    expect(sql).toMatch(/status\s*=\s*'live'/);
  });

  it('DB 报错时返回 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'));
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/journey_features/unguarded-count');
    expect(res.status).toBe(500);
  });
});
