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

  describe('GET /goals/audit', () => {
    it('returns audit list with stated vs actual progress', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr1',
            title: 'self-model KR',
            type: 'area_okr',
            status: 'in_progress',
            stated_progress: 100,
            initiative_total: '18',
            initiative_done: '5',
          },
          {
            id: 'kr2',
            title: 'org KR',
            type: 'area_okr',
            status: 'in_progress',
            stated_progress: 100,
            initiative_total: '0',
            initiative_done: '0',
          },
        ],
      });

      const res = await request(app).get('/goals/audit');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const kr1 = res.body[0];
      expect(kr1.id).toBe('kr1');
      expect(kr1.stated_progress).toBe(100);
      expect(kr1.actual_progress).toBe(28); // Math.round(5/18*100)
      expect(kr1.gap).toBe(72);
      expect(kr1.initiative_total).toBe(18);
      expect(kr1.initiative_done).toBe(5);

      // 无 initiative 的 KR，actual_progress 为 null
      const kr2 = res.body[1];
      expect(kr2.actual_progress).toBeNull();
      expect(kr2.gap).toBeNull();
    });

    it('returns 500 on db error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app).get('/goals/audit');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /goals/audit/apply', () => {
    it('applies corrections for KRs with gap > threshold and writes memory_stream', async () => {
      // 第一次 query：获取审计数据
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr1',
            title: 'self-model KR',
            stated_progress: 100,
            initiative_total: '18',
            initiative_done: '5',
          },
          {
            id: 'kr2',
            title: 'small gap KR',
            stated_progress: 80,
            initiative_total: '10',
            initiative_done: '7',
          },
        ],
      });
      // 第二次 query：UPDATE kr1
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 第三次 query：INSERT memory_stream
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/goals/audit/apply');
      expect(res.status).toBe(200);
      expect(res.body.applied).toBe(1); // 只有 kr1 gap=72 > 20
      expect(res.body.corrections[0].id).toBe('kr1');
      expect(res.body.corrections[0].old_progress).toBe(100);
      expect(res.body.corrections[0].new_progress).toBe(28);

      // 确认写入 memory_stream
      const memCall = mockPool.query.mock.calls[2];
      expect(memCall[0]).toContain('INSERT INTO memory_stream');
      expect(memCall[0]).toContain("source_type");
      const payload = JSON.parse(memCall[1][0]);
      expect(payload.event).toBe('kr_progress_correction');
      expect(payload.corrections).toHaveLength(1);
    });

    it('returns empty result when no corrections needed', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'kr1',
            title: 'accurate KR',
            stated_progress: 70,
            initiative_total: '10',
            initiative_done: '8',
          },
        ],
      });

      const res = await request(app).post('/goals/audit/apply');
      expect(res.status).toBe(200);
      expect(res.body.applied).toBe(0);
    });

    it('returns 500 on db error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('db error'));
      const res = await request(app).post('/goals/audit/apply');
      expect(res.status).toBe(500);
    });
  });
});
