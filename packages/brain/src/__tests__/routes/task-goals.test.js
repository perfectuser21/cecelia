/**
 * Route tests: /api/brain/goals (task-goals.js)
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
  const mod = await import('../../routes/task-goals.js');
  router = mod.default;
});

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
        rows: [{ id: 'g1', title: 'Goal 1', type: 'area_okr' }],
      });

      const res = await request(app).get('/goals');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const sql = mockPool.query.mock.calls[0][0];
      expect(sql).not.toContain('WHERE');
    });

    it('filters by type and status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/goals?type=area_okr&status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('type = $1');
      expect(sql).toContain('status = $2');
      expect(params).toEqual(['area_okr', 'active']);
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
    it('returns 404 for non-existent goal with lowercase error message', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/goals/non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('goal not found');
      // 404 响应不应包含 id 字段（统一格式）
      expect(res.body.id).toBeUndefined();
    });

    it('returns goal by id with specified fields', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', type: 'area_okr', title: 'Goal 1', description: 'desc', parent_id: null, project_id: null }],
      });
      const res = await request(app).get('/goals/g1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('g1');
      // 验证 SQL 使用指定字段 SELECT
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('SELECT id, type, title, description, parent_id, project_id');
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

  describe('GET /goals/audit', () => {
    it('returns audit result with summary and goals', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr-1',
            title: '免疫系统 KR',
            type: 'area_okr',
            status: 'in_progress',
            stated_progress: 100,
            actual_progress: '50',
            total_initiatives: '16',
            completed_initiatives: '8',
          },
          {
            id: 'kr-2',
            title: 'self-model KR',
            type: 'area_okr',
            status: 'in_progress',
            stated_progress: 100,
            actual_progress: '28',
            total_initiatives: '18',
            completed_initiatives: '5',
          },
        ],
      });

      const res = await request(app).get('/goals/audit');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('summary');
      expect(res.body).toHaveProperty('goals');
      expect(res.body.goals).toHaveLength(2);
      expect(res.body.goals[0]).toHaveProperty('stated_progress');
      expect(res.body.goals[0]).toHaveProperty('actual_progress');
      expect(res.body.goals[0]).toHaveProperty('discrepancy');
      expect(res.body.goals[0].discrepancy).toBe(50); // 100 - 50
      expect(res.body.summary.overstated).toBe(2);
    });

    it('returns 500 on db error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB error'));
      const res = await request(app).get('/goals/audit');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });

    it('handles goals with no initiatives (actual_progress null)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr-3',
            title: '组织架构 KR',
            type: 'area_okr',
            status: 'in_progress',
            stated_progress: 100,
            actual_progress: null,
            total_initiatives: '0',
            completed_initiatives: '0',
          },
        ],
      });

      const res = await request(app).get('/goals/audit');
      expect(res.status).toBe(200);
      const goal = res.body.goals[0];
      expect(goal.actual_progress).toBeNull();
      expect(goal.discrepancy).toBeNull();
      expect(res.body.summary.no_initiatives).toBe(1);
    });
  });
});
