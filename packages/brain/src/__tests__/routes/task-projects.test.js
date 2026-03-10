/**
 * Route tests: /api/brain/projects (task-projects.js)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/task-projects.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects', router);
  return app;
}

describe('task-projects routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /projects', () => {
    it('lists all projects without filters', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Project 1' }],
      });

      const res = await request(app).get('/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('filters by status and type', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?status=active&type=initiative');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('type = $2');
      expect(params).toEqual(['active', 'initiative']);
    });

    it('filters by kr_id using subquery', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?kr_id=kr-1');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('project_kr_links');
    });

    it('filters top_level (parent_id IS NULL)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?top_level=true');
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('parent_id IS NULL');
    });
  });

  describe('GET /projects/:id', () => {
    it('returns 404 for non-existent project', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/projects/non-existent');
      expect(res.status).toBe(404);
    });

    it('returns project by id', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Project 1' }],
      });
      const res = await request(app).get('/projects/p1');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Project 1');
    });
  });

  describe('PATCH /projects/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/projects/p1').send({});
      expect(res.status).toBe(400);
    });

    it('updates status and name', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'completed', name: 'Updated' }],
      });

      const res = await request(app).patch('/projects/p1').send({ status: 'completed', name: 'Updated' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('status = $1');
      expect(sql).toContain('name = $2');
    });

    it('returns 404 when project not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/projects/missing').send({ name: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
