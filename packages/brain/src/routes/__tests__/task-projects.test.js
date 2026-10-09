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

// /locate 与 /:id/tasks（棒3，任务 8a40825a）的路由测试单独放在
// routes/__tests__/project-locate-routes.test.js（配对新文件 routes/project-locate-routes.js）。

// PATCH /:id/brief 动态 import 这个模块；DB 侧真实逻辑单测见
// lib/__tests__/project-brief-apply.test.js，这里只验证路由接线。
const mockApplyProjectBriefDelta = vi.hoisted(() => vi.fn());
vi.mock('../../lib/project-brief-apply.js', () => ({
  applyProjectBriefDelta: (...args) => mockApplyProjectBriefDelta(...args),
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

const P1_UUID = '00000000-0000-4000-8000-000000000001';

describe('task-projects routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // 棒3（任务 8a40825a）：只验证 task-projects.js 把 project-locate-routes.js 正确挂到
  // /:id 之前（不被 GET/PATCH /:id 的 :id 段吞掉）；打分/建单细节在 project-locate-routes.test.js。
  it('POST /projects/locate 已挂载（未被 /:id 拦截）', async () => {
    const res = await request(app).post('/projects/locate').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('text is required');
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
      const res = await request(app).get('/projects/00000000-0000-4000-8000-000000000002');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('project not found');
      // 404 响应不应包含 id 字段（统一格式）
      expect(res.body.id).toBeUndefined();
    });

    it('returns project by id from projects，附 children_count/completed_count', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ id: P1_UUID, name: 'Project 1', title: 'Project 1', description: 'd', kr_id: 'kr-1' }],
        })
        .mockResolvedValueOnce({ rows: [{ total: 3, completed: 1 }] });
      const res = await request(app).get(`/projects/${P1_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(P1_UUID);
      expect(res.body.children_count).toBe(3);
      expect(res.body.completed_count).toBe(1);
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toContain('FROM projects');
      const [countSql, countParams] = mockPool.query.mock.calls[1];
      expect(countSql).toContain('project_id');
      expect(countParams).toEqual([P1_UUID]);
    });

    // 回归：非法 id 曾让 async 处理函数 reject 后请求挂死（Express 4 不接 async 错误）
    it('非法 id → 400 固定文案，不查库、不泄露数据库原文', async () => {
      const res = await request(app).get('/projects/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid project id: must be a UUID');
      expect(mockPool.query).not.toHaveBeenCalled();
      expect(JSON.stringify(res.body)).not.toContain('invalid input syntax');
    });

    it('合法但不存在的 uuid → 404', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/projects/00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
    });

    it('查库抛错 → 500，响应体不含错误原文', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('boom db detail'));
      const res = await request(app).get('/projects/00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('boom db detail');
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

  describe('PATCH /projects/:id/brief', () => {
    it('returns 400 when brief_delta missing or not an object', async () => {
      let res = await request(app).patch('/projects/p1/brief').send({});
      expect(res.status).toBe(400);
      res = await request(app).patch('/projects/p1/brief').send({ brief_delta: 'not-an-object' });
      expect(res.status).toBe(400);
      res = await request(app).patch('/projects/p1/brief').send({ brief_delta: ['x'] });
      expect(res.status).toBe(400);
      expect(mockApplyProjectBriefDelta).not.toHaveBeenCalled();
    });

    it('应用成功 → 透传 applyProjectBriefDelta 结果，task_id 可选透传', async () => {
      mockApplyProjectBriefDelta.mockResolvedValueOnce({ applied: true, brief: { status: '新现状' }, escalated: false, pending_action_id: null, add_steps: [], cancel_steps: [], reorder: [] });
      const res = await request(app).patch('/projects/p1/brief').send({ brief_delta: { status: '新现状' }, task_id: 'task-9' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ applied: true, brief: { status: '新现状' } });
      expect(mockApplyProjectBriefDelta).toHaveBeenCalledWith(mockPool, { projectId: 'p1', rawDelta: { status: '新现状' }, taskId: 'task-9' });
    });

    it('task_id 缺省 → taskId 传 null', async () => {
      mockApplyProjectBriefDelta.mockResolvedValueOnce({ applied: true, brief: {} });
      await request(app).patch('/projects/p1/brief').send({ brief_delta: { status: 'x' } });
      expect(mockApplyProjectBriefDelta).toHaveBeenCalledWith(mockPool, { projectId: 'p1', rawDelta: { status: 'x' }, taskId: null });
    });

    it('apply 返回 null 且项目确实存在 → 400（delta 清洗后全非法）', async () => {
      mockApplyProjectBriefDelta.mockResolvedValueOnce(null);
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });
      const res = await request(app).patch('/projects/p1/brief').send({ brief_delta: { unknown_field: 1 } });
      expect(res.status).toBe(400);
    });

    it('apply 返回 null 且项目不存在 → 404', async () => {
      mockApplyProjectBriefDelta.mockResolvedValueOnce(null);
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).patch('/projects/missing/brief').send({ brief_delta: { status: 'x' } });
      expect(res.status).toBe(404);
    });
  });
});
