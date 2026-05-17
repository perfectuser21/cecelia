/**
 * Route tests: /api/brain/goals (task-goals.js)
 * 已迁移到新 OKR 表：objectives + key_results
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
    it('lists all goals without filters (UNION ALL objectives + key_results)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'Goal 1', type: 'area_okr' }],
      });

      const res = await request(app).get('/goals');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const sql = mockPool.query.mock.calls[0][0];
      // 新实现：UNION ALL objectives + key_results（wrapped in subquery）
      expect(sql).toContain('FROM objectives');
      expect(sql).toContain('FROM key_results');
      expect(sql).toContain('UNION ALL');
    });

    it('filters by type=area_okr (only objectives)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/goals?type=area_okr&status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      // type=area_okr 只查 objectives，不走 UNION ALL
      expect(sql).toContain('FROM objectives');
      expect(sql).not.toContain('UNION ALL');
      expect(sql).toContain('status = $1');
      expect(params).toEqual(['active']);
    });

    it('filters by type=area_kr (only key_results)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/goals?type=area_kr&status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM key_results');
      expect(sql).not.toContain('UNION ALL');
      expect(sql).toContain('status = $1');
      expect(params).toEqual(['active']);
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
    it('returns 404 for non-existent goal (checks both objectives and key_results)', async () => {
      // 查询1: objectives 未找到
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询2: key_results 未找到
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/goals/non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('goal not found');
      // 404 响应不应包含 id 字段（统一格式）
      expect(res.body.id).toBeUndefined();
      // 需要查询 2 次（objectives + key_results）
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('returns goal by id from objectives', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', type: 'area_okr', title: 'Goal 1', description: null, parent_id: null, project_id: null }],
      });
      const res = await request(app).get('/goals/g1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('g1');
      // 第一次查询应查 objectives
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM objectives');
      // 只需一次查询（在 objectives 找到）
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    it('falls back to key_results when not found in objectives', async () => {
      // objectives 未找到
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // key_results 找到
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr1', type: 'area_kr', title: 'KR 1', description: null, parent_id: 'obj1', project_id: null }],
      });
      const res = await request(app).get('/goals/kr1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('kr1');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [sql2] = mockPool.query.mock.calls[1];
      expect(sql2).toContain('FROM key_results');
    });
  });

  describe('PATCH /goals/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/goals/g1').send({});
      expect(res.status).toBe(400);
    });

    it('updates title and status (tries objectives first)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'g1', title: 'Updated', status: 'completed' }],
      });

      const res = await request(app).patch('/goals/g1').send({ title: 'Updated', status: 'completed' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('title = $1');
      expect(sql).toContain('status = $2');
      expect(sql).toContain('UPDATE objectives');
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

    it('returns 404 when goal not found in both tables', async () => {
      // objectives: 0 行
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // key_results: 0 行
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).patch('/goals/missing').send({ title: 'x' });
      expect(res.status).toBe(404);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('updates key_results when not found in objectives', async () => {
      // objectives: 0 行
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // key_results: 找到
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr1', status: 'completed' }],
      });

      const res = await request(app).patch('/goals/kr1').send({ status: 'completed' });
      expect(res.status).toBe(200);
      const [sql2] = mockPool.query.mock.calls[1];
      expect(sql2).toContain('UPDATE key_results');
    });
  });

  describe('GET /goals/audit', () => {
    it('returns audit result with summary and goals', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr-1',
            title: '免疫系统 KR',
            type: 'area_kr',
            status: 'in_progress',
            stated_progress: 100,
            actual_progress: '50',
            total_initiatives: '16',
            completed_initiatives: '8',
          },
          {
            id: 'kr-2',
            title: 'self-model KR',
            type: 'area_kr',
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
            type: 'area_kr',
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
