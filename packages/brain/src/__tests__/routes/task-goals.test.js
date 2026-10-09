/**
 * Route tests: /api/brain/goals (task-goals.js)
 * 已迁移到新 OKR 表：objectives + key_results
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../db.js', () => ({ default: mockPool }));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let router;
let app;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../../routes/task-goals.js');
  router = mod.default;
  // 全量套件并发运行时，为每个 request(app) 反复创建临时监听 socket 会偶发
  // ECONNRESET。文件级复用一个真实 server，同时保留逐例 mock 隔离。
  app = await new Promise((resolve) => {
    const server = createApp().listen(0, () => resolve(server));
  });
});

afterAll(async () => {
  if (!app) return;
  await new Promise((resolve, reject) => {
    app.close((error) => (error ? reject(error) : resolve()));
  });
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/goals', router);
  return app;
}

// 来源检查与更新分别提供返回值，避免增加身份查询时消耗UPDATE fixture。
function mockGoalPatch({ objective = null, keyResult = null } = {}) {
  mockPool.query.mockImplementation(async (sql) => {
    if (/^SELECT metadata, custom_props FROM (objectives|key_results) WHERE id=\$1$/.test(sql)) {
      const row = sql.includes('FROM objectives') ? objective : keyResult;
      return { rows: row ? [{ metadata: row.metadata || {}, custom_props: row.custom_props || {} }] : [] };
    }
    if (sql.startsWith('UPDATE objectives ')) return { rows: objective ? [objective] : [] };
    if (sql.startsWith('UPDATE key_results ')) return { rows: keyResult ? [keyResult] : [] };
    throw new Error(`测试未定义SQL:${sql}`);
  });
}
const patchWrites = () => mockPool.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE '));

const G1_UUID = '00000000-0000-4000-8000-000000000011';
const KR1_UUID = '00000000-0000-4000-8000-000000000012';

describe('task-goals routes', () => {
  beforeEach(() => {
    // clearAllMocks 只清调用记录，不清未消费的 mockResolvedValueOnce 队列；
    // 前一例若在查询前断开，旧返回值会串进后一例并放大为级联失败。
    mockPool.query.mockReset();
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

      const res = await request(app).get('/goals/00000000-0000-4000-8000-000000000003');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('goal not found');
      // 404 响应不应包含 id 字段（统一格式）
      expect(res.body.id).toBeUndefined();
      // 需要查询 2 次（objectives + key_results）
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('returns goal by id from objectives', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: G1_UUID, type: 'area_okr', title: 'Goal 1', description: null, parent_id: null, project_id: null }],
      });
      const res = await request(app).get(`/goals/${G1_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(G1_UUID);
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
        rows: [{ id: KR1_UUID, type: 'area_kr', title: 'KR 1', description: null, parent_id: 'obj1', project_id: null }],
      });
      const res = await request(app).get(`/goals/${KR1_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(KR1_UUID);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [sql2] = mockPool.query.mock.calls[1];
      expect(sql2).toContain('FROM key_results');
    });

    // 回归：非法 id 曾让 async 处理函数 reject 后请求挂死（Express 4 不接 async 错误）
    it('非法 id → 400 固定文案，不查库', async () => {
      const res = await request(app).get('/goals/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid goal id: must be a UUID');
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('合法 uuid 两表都查不到 → 404', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get('/goals/00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('goal not found');
    });

    it('查库抛错 → 500，响应体不含错误原文', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('boom db detail'));
      const res = await request(app).get('/goals/00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('boom db detail');
    });
  });

  describe('PATCH /goals/:id', () => {
    it('returns 400 when no fields provided', async () => {
      const res = await request(app).patch('/goals/g1').send({});
      expect(res.status).toBe(400);
    });

    it('updates title and status (tries objectives first)', async () => {
      const updated = { id: 'g1', title: 'Updated', status: 'completed' };
      mockGoalPatch({ objective: updated });

      const res = await request(app).patch('/goals/g1').send({ title: 'Updated', status: 'completed' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mockPool.query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual([
        'SELECT metadata, custom_props FROM objectives WHERE id=$1',
        'SELECT metadata, custom_props FROM key_results WHERE id=$1',
      ]);
      expect(patchWrites()).toHaveLength(1);
      const [sql] = patchWrites()[0];
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
      mockGoalPatch();
      const res = await request(app).patch('/goals/missing').send({ title: 'x' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Goal not found', id: 'missing' });
      expect(mockPool.query).toHaveBeenCalledTimes(4); // 两次来源检查和两次更新。
      expect(patchWrites()).toHaveLength(2);
      expect(patchWrites()[0][0]).toContain('UPDATE objectives');
      expect(patchWrites()[1][0]).toContain('UPDATE key_results');
    });

    it('updates key_results when not found in objectives', async () => {
      const updated = { id: 'kr1', status: 'completed' };
      mockGoalPatch({ keyResult: updated });
      const res = await request(app).patch('/goals/kr1').send({ status: 'completed' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(patchWrites()).toHaveLength(2);
      expect(patchWrites()[0][0]).toContain('UPDATE objectives');
      const [sql2] = patchWrites()[1];
      expect(sql2).toContain('UPDATE key_results');
    });
  });

  describe('公司正式字段来源保护', () => {
    it.each([
      ['objective', { title: '机器改名' }], ['objective', { status: 'completed' }],
      ['keyResult', { title: '机器改名' }], ['keyResult', { status: 'completed' }],
    ])('%s的title/status修改返回409，检查来源后零UPDATE：%j', async (table, body) => {
      const company = { id: 'company', metadata: { metric_mode: 'company_formula_v1' }, custom_props: { company_notion: { page_id: 'notion-company-source' } } };
      mockGoalPatch({ [table]: company });
      const response = await request(app).patch('/goals/company').send(body);
      expect(response.status).toBe(409);
      expect(response.body.details).toContain('保留字段');
      expect(patchWrites()).toHaveLength(0);
      expect(mockPool.query.mock.calls.every(([sql]) => sql.startsWith('SELECT metadata, custom_props'))).toBe(true);
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

  describe('PATCH /goals/:id metadata merge (T6 两轴衔接)', () => {
    it('带 metadata → SQL 用 COALESCE merge 且参数为 JSON 字符串', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'kr1', metadata: { target_abilities: ['ab1'] } }],
      });

      const res = await request(app)
        .patch('/goals/kr1')
        .send({ metadata: { target_abilities: ['ab1'] } });

      expect(res.status).toBe(200);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("metadata = COALESCE(metadata, '{}'::jsonb) ||");
      expect(params).toContain(JSON.stringify({ target_abilities: ['ab1'] }));
    });

    it('不带 metadata → SQL 不含 metadata（回归保护）', async () => {
      mockGoalPatch({ objective: { id: 'kr1', title: 'x' } });
      const res = await request(app).patch('/goals/kr1').send({ title: 'x' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: 'kr1', title: 'x' });
      expect(patchWrites()).toHaveLength(1);
      const [sql] = patchWrites()[0];
      expect(sql).not.toContain('metadata');
    });
  });
});
