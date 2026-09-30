/**
 * Route tests: POST /api/brain/projects/locate + POST /api/brain/projects/:id/tasks
 * (routes/project-locate-routes.js) — 链 2afa6d69 棒3，任务 8a40825a。
 *
 * /locate 的打分逻辑在 project-locate.js 已有独立单测覆盖，这里只 mock 掉打分结果，
 * 验证路由层"参数怎么传、响应怎么组装"。/:id/tasks 是对 createRoutedTask 的薄封装
 * （建单闸 + sequence_no/depends_on 自动填），真实建单路径（work_routing_receipts/
 * advisory lock/多张表）在 __tests__/integration/project-locate-tasks.pg.integration.test.js
 * 覆盖；这里只 mock createRoutedTask 本体，验证路由层参数组装。
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

const mockScoreProjectCandidates = vi.hoisted(() => vi.fn());
const mockResolveProjectLocateThreshold = vi.hoisted(() => vi.fn());
vi.mock('../../project-locate.js', () => ({
  scoreProjectCandidates: mockScoreProjectCandidates,
  resolveProjectLocateThreshold: mockResolveProjectLocateThreshold,
}));

const mockCreateRoutedTask = vi.hoisted(() => vi.fn());
vi.mock('../../work-routing-store.js', () => ({
  createRoutedTask: mockCreateRoutedTask,
}));

let router;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/project-locate-routes.js');
  router = mod.default;
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/projects', router);
  return app;
}

function mockPoolBySql(handlers) {
  mockPool.query.mockImplementation((sql, params) => {
    for (const [pattern, rows] of handlers) {
      if (pattern.test(sql)) {
        return Promise.resolve(typeof rows === 'function' ? rows(params) : rows);
      }
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('project-locate-routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // 棒3（任务 8a40825a）：一句话归位 → POST /locate 找/建 project，attach 时用
  // POST /:id/tasks 一步建单（自动填 project_id/sequence_no/depends_on）。
  describe('POST /projects/locate', () => {
    it('text 缺失 → 400，不查库', async () => {
      const res = await request(app).post('/projects/locate').send({});
      expect(res.status).toBe(400);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('候选为空 → suggestion=create，不调用打分', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockResolveProjectLocateThreshold.mockReturnValueOnce(0.55);

      const res = await request(app).post('/projects/locate').send({ text: '做一个新东西' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ candidates: [], suggestion: 'create', threshold: 0.55 });
      expect(mockScoreProjectCandidates).not.toHaveBeenCalled();
    });

    it('命中候选且最高分≥阈值 → suggestion=attach，按分数降序、reason 标注 embedding/keyword', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 'p1', name: '智能获客', status: 'active', kr_id: 'kr-1', open_task_count: 2, last_activity_at: 't1' },
          { id: 'p2', name: '微信客服', status: 'active', kr_id: 'kr-2', open_task_count: 0, last_activity_at: 't2' },
        ],
      });
      mockResolveProjectLocateThreshold.mockReturnValueOnce(0.55);
      mockScoreProjectCandidates.mockResolvedValueOnce({
        method: 'embedding',
        scored: [
          { id: 'p2', name: '微信客服', status: 'active', kr_id: 'kr-2', open_task_count: 0, last_activity_at: 't2', score: 0.3 },
          { id: 'p1', name: '智能获客', status: 'active', kr_id: 'kr-1', open_task_count: 2, last_activity_at: 't1', score: 0.81 },
        ],
      });

      const res = await request(app).post('/projects/locate').send({ text: '给智能获客加个新步骤' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toBe('attach');
      expect(res.body.candidates[0]).toMatchObject({ project_id: 'p1', score: 0.81, reason: 'embedding_cosine' });
      expect(res.body.candidates[1]).toMatchObject({ project_id: 'p2', score: 0.3 });
    });

    it('最高分低于阈值 → suggestion=create', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: '不相关项目', status: 'active', kr_id: null, open_task_count: 0, last_activity_at: null }] });
      mockResolveProjectLocateThreshold.mockReturnValueOnce(0.55);
      mockScoreProjectCandidates.mockResolvedValueOnce({
        method: 'keyword',
        scored: [{ id: 'p1', name: '不相关项目', status: 'active', kr_id: null, open_task_count: 0, last_activity_at: null, score: 0.1 }],
      });

      const res = await request(app).post('/projects/locate').send({ text: '全新方向' });
      expect(res.status).toBe(200);
      expect(res.body.suggestion).toBe('create');
      expect(res.body.candidates[0].reason).toBe('keyword_bigram_coverage');
    });

    it('kr_id 过滤透传进 SQL；limit 截断候选数量', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockResolveProjectLocateThreshold.mockReturnValueOnce(0.55);

      await request(app).post('/projects/locate').send({ text: 'x', kr_id: 'kr-9', limit: 1 });
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('kr_id');
      expect(params).toContain('kr-9');
    });
  });

  describe('POST /projects/:id/tasks', () => {
    // findProjectById（project-root-gate.js）用正则校验 projectId 必须是真 UUID 形状，
    // 非法形状直接短路返回 null（不查库）——测试用例必须用真 UUID，否则闸永远判 project_root_required。
    const PID = '11111111-1111-1111-1111-111111111111';
    const PREV_ID = '22222222-2222-2222-2222-222222222222';

    it('title 缺失 → 400，不查库', async () => {
      const res = await request(app).post(`/projects/${PID}/tasks`).send({});
      expect(res.status).toBe(400);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('project 不存在 → 404', async () => {
      mockPoolBySql([[/SELECT id FROM projects WHERE id = \$1/, { rows: [] }]]);
      const res = await request(app).post(`/projects/${PID}/tasks`).send({ title: 't', change_kind: 'bugfix' });
      expect(res.status).toBe(404);
    });

    it('change_kind 非法 → 400', async () => {
      mockPoolBySql([[/SELECT id FROM projects WHERE id = \$1/, { rows: [{ id: PID }] }]]);
      const res = await request(app).post(`/projects/${PID}/tasks`).send({ title: 't', change_kind: 'not-a-real-kind' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_change_kind');
    });

    it('未给 depends_on 时默认依赖 project 下最后一个非终态任务；sequence_no=max+1；project_id 回填', async () => {
      mockPoolBySql([
        [/SELECT COALESCE\(MAX\(sequence_no\), 0\) \+ 1 AS n FROM tasks WHERE project_id = \$1/, { rows: [{ n: 3 }] }],
        [/ORDER BY sequence_no DESC/, { rows: [{ id: PREV_ID }] }],
        [/SELECT id FROM tasks WHERE id = ANY/, { rows: [{ id: PREV_ID }] }],
        [/SELECT id FROM projects WHERE id = \$1::uuid/, { rows: [{ id: PID }] }],
        [/SELECT id FROM projects WHERE id = \$1/, { rows: [{ id: PID }] }],
      ]);
      mockCreateRoutedTask.mockResolvedValueOnce({ task: { id: 'new-task', project_id: PID, sequence_no: 3 } });

      const res = await request(app).post(`/projects/${PID}/tasks`).send({ title: '第3棒', change_kind: 'capability_change' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'new-task', project_id: PID, sequence_no: 3 });

      const call = mockCreateRoutedTask.mock.calls[0][1];
      expect(call.task.project_id).toBe(PID);
      expect(call.task.sequence_no).toBe(3);
      expect(call.metadata.multi_task).toBe(true);
      expect(call.metadata.depends_on).toEqual([PREV_ID]);
    });

    it('显式 depends_on: [] 声明并行 — 不查上一棒', async () => {
      mockPoolBySql([
        [/SELECT COALESCE\(MAX\(sequence_no\), 0\) \+ 1 AS n FROM tasks WHERE project_id = \$1/, { rows: [{ n: 1 }] }],
        [/SELECT id FROM projects WHERE id = \$1::uuid/, { rows: [{ id: PID }] }],
        [/SELECT id FROM projects WHERE id = \$1/, { rows: [{ id: PID }] }],
      ]);
      mockCreateRoutedTask.mockResolvedValueOnce({ task: { id: 'new-task2', project_id: PID, sequence_no: 1 } });

      const res = await request(app).post(`/projects/${PID}/tasks`).send({ title: '并行棒', change_kind: 'capability_change', depends_on: [] });
      expect(res.status).toBe(201);
      const call = mockCreateRoutedTask.mock.calls[0][1];
      expect(call.metadata.depends_on).toEqual([]);
      const prevTaskQuery = mockPool.query.mock.calls.some(([sql]) => /ORDER BY sequence_no DESC/.test(sql));
      expect(prevTaskQuery).toBe(false);
    });

    it('depends_on 传非法 uuid → 400', async () => {
      mockPoolBySql([[/SELECT id FROM projects WHERE id = \$1/, { rows: [{ id: PID }] }]]);
      const res = await request(app).post(`/projects/${PID}/tasks`).send({ title: 't', change_kind: 'bugfix', depends_on: ['not-a-uuid'] });
      expect(res.status).toBe(400);
    });
  });
});
