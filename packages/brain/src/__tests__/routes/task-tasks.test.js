/**
 * Route tests: /api/brain/tasks (task-tasks.js)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

const { default: router } = await import('../../routes/task-tasks.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/tasks', router);
  return app;
}

describe('task-tasks routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /tasks', () => {
    it('lists tasks with default limit/offset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'Task 1', status: 'queued' }],
      });

      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      // Default limit=200, offset=0
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(200);
      expect(params).toContain(0);
    });

    it('filters by status and project_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?status=queued&project_id=proj-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('project_id = $2');
      expect(params[0]).toBe('queued');
      expect(params[1]).toBe('proj-1');
    });

    it('respects custom limit and offset', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/tasks?limit=10&offset=30');
      const params = mockPool.query.mock.calls[0][1];
      expect(params).toContain(10);
      expect(params).toContain(30);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns 404 for non-existent task', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/tasks/non-existent');
      expect(res.status).toBe(404);
    });

    it('returns task by id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'Task 1' }],
      });
      const res = await request(app).get('/tasks/t1');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Task 1');
    });
  });

  describe('PATCH /tasks/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/tasks/t1').send({});
      expect(res.status).toBe(400);
    });

    it('updates status and priority', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'completed', priority: 'P0' }],
      });

      const res = await request(app).patch('/tasks/t1').send({ status: 'completed', priority: 'P0' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('priority = $2');
    });

    it('returns 404 when task not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/tasks/missing').send({ title: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
