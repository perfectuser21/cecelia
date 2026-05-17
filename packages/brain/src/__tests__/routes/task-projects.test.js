/**
 * Route tests: /api/brain/projects (task-projects.js)
 * 已迁移到新 OKR 表：okr_projects
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockGetCompareMetrics = vi.hoisted(() => vi.fn());
const mockGenerateCompareReport = vi.hoisted(() => vi.fn());
vi.mock('../../project-compare.js', () => ({
  getCompareMetrics: mockGetCompareMetrics,
  generateCompareReport: mockGenerateCompareReport,
}));

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
    it('lists all projects without filters (from okr_projects)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', title: 'Project 1' }],
      });

      const res = await request(app).get('/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM okr_projects');
    });

    it('filters by status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM okr_projects');
      expect(sql).toContain('status = $1');
      expect(params).toEqual(['active']);
    });

    it('filters by kr_id directly (no subquery)', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?kr_id=kr-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('kr_id = $1');
      expect(sql).not.toContain('project_kr_links');
      expect(params).toEqual(['kr-1']);
    });

    it('filters by area_id', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?area_id=area-1');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('area_id = $1');
      expect(params).toEqual(['area-1']);
    });
  });

  describe('GET /projects/:id', () => {
    it('returns 404 for non-existent project with lowercase error message', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/projects/non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('project not found');
      // 404 响应不应包含 id 字段（统一格式）
      expect(res.body.id).toBeUndefined();
    });

    it('returns project by id from okr_projects with compat fields', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', title: 'Project 1', description: null, kr_id: 'kr-1', goal_id: null }],
      });
      const res = await request(app).get('/projects/p1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('p1');
      // 验证 SQL 查询 okr_projects 并返回兼容字段
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM okr_projects');
      expect(sql).toContain('kr_id');
      expect(sql).toContain('NULL::uuid AS goal_id');
    });
  });

  describe('GET /compare', () => {
    it('ids 少于 2 个时返回 400', async () => {
      const res = await request(app).get('/projects/compare?ids=only-one');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least 2/);
    });

    it('有效 ids 时调用 getCompareMetrics 并返回结果', async () => {
      const mockResult = { projects: [{ id: 'a' }, { id: 'b' }] };
      mockGetCompareMetrics.mockResolvedValueOnce(mockResult);

      const res = await request(app).get('/projects/compare?ids=a,b');
      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(2);
      expect(mockGetCompareMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ project_ids: ['a', 'b'] })
      );
    });
  });

  describe('POST /compare/report', () => {
    it('调用 generateCompareReport 并返回报告', async () => {
      const mockReport = { projects: [], summary: 'ok', generated_at: '2026-03-10' };
      mockGenerateCompareReport.mockResolvedValueOnce(mockReport);

      const res = await request(app)
        .post('/projects/compare/report')
        .send({ project_ids: ['a', 'b'] });

      expect(res.status).toBe(200);
      expect(res.body.summary).toBe('ok');
      expect(res.body.generated_at).toBeTruthy();
      expect(mockGenerateCompareReport).toHaveBeenCalledWith(
        expect.objectContaining({ project_ids: ['a', 'b'] })
      );
    });
  });

  describe('PATCH /projects/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/projects/p1').send({});
      expect(res.status).toBe(400);
    });

    it('updates status', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'completed' }],
      });

      const res = await request(app).patch('/projects/p1').send({ status: 'completed' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('UPDATE okr_projects');
      expect(sql).toContain('status = $1');
    });

    it('updates name (mapped to title in okr_projects)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', title: 'Updated' }],
      });

      const res = await request(app).patch('/projects/p1').send({ name: 'Updated' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('UPDATE okr_projects');
      expect(sql).toContain('title = $1');
    });

    it('returns 404 when project not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/projects/missing').send({ status: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
