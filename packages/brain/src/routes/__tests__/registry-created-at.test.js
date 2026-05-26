import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

describe('GET /api/brain/registry — created_at 列名', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
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
});
