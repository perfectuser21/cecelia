/**
 * Route tests: /api/brain/projects (task-projects.js)
 * 棒1（任务 9e785997，决策 ee4842a6/3feeae3e）：数据源从 okr_projects 迁到 projects 真身表，
 * 与 /api/brain/okr/projects（okr-hierarchy.js mountCrud）读写同一张表。新增 POST /、
 * GET /:id 附 children_count/completed_count。
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
    it('lists all projects without filters (from projects)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Project 1', title: 'Project 1' }],
      });

      const res = await request(app).get('/projects');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM projects');
    });

    it('filters by status', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get('/projects?status=active');
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM projects');
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

    it('returns project by id from projects，附 children_count/completed_count', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: 'p1', name: 'Project 1', title: 'Project 1', description: 'd', kr_id: 'kr-1' }],
        })
        .mockResolvedValueOnce({ rows: [{ total: 3, completed: 1 }] });
      const res = await request(app).get('/projects/p1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('p1');
      expect(res.body.children_count).toBe(3);
      expect(res.body.completed_count).toBe(1);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM projects');
      const [countSql, countParams] = mockPool.query.mock.calls[1];
      expect(countSql).toContain('project_id');
      expect(countParams).toEqual(['p1']);
    });
  });

  describe('POST /projects', () => {
    it('name 缺失 → 400', async () => {
      const res = await request(app).post('/projects').send({});
      expect(res.status).toBe(400);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('kr_id 给了但不是真实 key_results → 400 kr_id_not_key_result', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // key_results 校验查无
      const res = await request(app).post('/projects').send({ name: 'p', kr_id: 'ghost-kr' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('kr_id_not_key_result');
    });

    it('创建成功 → 201 且返回新行', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'kr-1' }] }) // key_results 校验命中
        .mockResolvedValueOnce({ rows: [{ id: 'p-new', name: '新项目' }] }); // INSERT
      const res = await request(app).post('/projects').send({ name: '新项目', kr_id: 'kr-1' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe('p-new');
      const [sql] = mockPool.query.mock.calls[1];
      expect(sql).toContain('INSERT INTO projects');
    });

    it('无 kr_id → 直接建，不查 key_results', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p-new2', name: '无 KR 项目' }] });
      const res = await request(app).post('/projects').send({ name: '无 KR 项目' });
      expect(res.status).toBe(201);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
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
      expect(sql).toContain('UPDATE projects');
      expect(sql).toContain('status = $1');
    });

    it('updates name (mapped to name column in projects)', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Updated' }],
      });

      const res = await request(app).patch('/projects/p1').send({ name: 'Updated' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('UPDATE projects');
      expect(sql).toContain('name = $1');
    });

    it('title 字段向后兼容也映射到 name 列', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Updated2' }] });
      const res = await request(app).patch('/projects/p1').send({ title: 'Updated2' });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('name = $1');
    });

    it('kr_id/description/owner_role/start_date/end_date/metadata 均可更新', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      const res = await request(app).patch('/projects/p1').send({
        kr_id: 'kr-2', description: 'd2', owner_role: 'line02', start_date: '2026-01-01', end_date: '2026-02-01', metadata: { a: 1 },
      });
      expect(res.status).toBe(200);
      const [sql] = mockPool.query.mock.calls[0];
      for (const col of ['kr_id', 'description', 'owner_role', 'start_date', 'end_date', 'metadata']) {
        expect(sql).toContain(`${col} = $`);
      }
    });

    it('returns 404 when project not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/projects/missing').send({ status: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
