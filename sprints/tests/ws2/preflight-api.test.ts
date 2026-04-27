import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

import initiativesRoutes from '../../../packages/brain/src/routes/initiatives.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/initiatives', initiativesRoutes);
  return app;
}

describe('Workstream 2 — GET /api/brain/initiatives/:id/preflight [BEHAVIOR]', () => {
  beforeEach(() => {
    mockPool.query.mockReset();
  });

  it('returns 404 with error body when initiative does not exist', async () => {
    // 1st query: initiative existence check → empty
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const app = makeApp();
    const res = await request(app).get('/api/brain/initiatives/does-not-exist/preflight');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 200 with empty records array for known initiative with no history', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ini-A' }] }) // exists
      .mockResolvedValueOnce({ rows: [] });               // history empty
    const app = makeApp();
    const res = await request(app).get('/api/brain/initiatives/ini-A/preflight');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('records');
    expect(Array.isArray(res.body.records)).toBe(true);
    expect(res.body.records).toHaveLength(0);
  });
});
