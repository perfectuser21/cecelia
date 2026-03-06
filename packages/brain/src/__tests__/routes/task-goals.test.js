/**
 * Route tests: /api/brain/goals (task-goals.js)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

const { default: router } = await import('../../routes/task-goals.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/goals', router);
  return app;
}

describe('task-goals routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /goals', () => {
    it('lists all goals without filters', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'Goal 1', type: 'kr' }],
      });

      const res = await request(app).get('/goals');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).not.toContain('WHERE');
    });

    it('filters by type and status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/goals?type=kr&status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('type = $1');
      expect(sql).toContain('status = $2');
      expect(params).toEqual(['kr', 'active']);
    });

    it('supports limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/goals?limit=10&offset=20');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
      expect(params).toContain(10);
      expect(params).toContain(20);
    });
  });

  describe('GET /goals/:id', () => {
    it('returns 404 for non-existent goal', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/goals/non-existent');
      expect(res.status).toBe(404);
    });

    it('returns goal by id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'Goal 1' }],
      });
      const res = await request(app).get('/goals/g1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('g1');
    });
  });

  describe('PATCH /goals/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/goals/g1').send({});
      expect(res.status).toBe(400);
    });

    it('updates title and status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'Updated', status: 'completed' }],
      });

      const res = await request(app).patch('/goals/g1').send({ title: 'Updated', status: 'completed' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('status = $2');
    });

    it('merges custom_props as JSONB', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', custom_props: { foo: 'bar' } }],
      });

      await request(app).patch('/goals/g1').send({ custom_props: { foo: 'bar' } });
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('custom_props = custom_props ||');
      expect(sql).toContain('::jsonb');
    });

    it('returns 404 when goal not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/goals/missing').send({ title: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
