/**
 * Route tests: /api/brain/task-router/diagnose (task-router-diagnose.js)
 *
 * 诊断 KR 下所有 Initiative 的任务状态，分析派发阻塞原因
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = {
  query: vi.fn(),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

const { default: router } = await import('../../routes/task-router-diagnose.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/task-router', router);
  return app;
}

// ── 共享测试数据 ──────────────────────────────────────────────────────────

const KR_ID = '11111111-1111-1111-1111-111111111111';
const INITIATIVE_ID_A = 'aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INITIATIVE_ID_B = 'bbbb0000-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TASK_ID_1 = 'cccc0001-cccc-cccc-cccc-cccccccccccc';
const TASK_ID_2 = 'cccc0002-cccc-cccc-cccc-cccccccccccc';
const TASK_ID_3 = 'cccc0003-cccc-cccc-cccc-cccccccccccc';
const DEP_TASK_ID = 'dddd0001-dddd-dddd-dddd-dddddddddddd';

const krRow = {
  id: KR_ID,
  title: '测试 KR',
  status: 'active',
  progress: 30,
  priority: 'P1',
};

const initiativeRows = [
  {
    id: INITIATIVE_ID_A,
    name: 'Initiative A',
    status: 'active',
    type: 'initiative',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
  },
  {
    id: INITIATIVE_ID_B,
    name: 'Initiative B',
    status: 'paused',
    type: 'project',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-15T00:00:00Z',
  },
];

describe('task-router-diagnose routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // ── KR 不存在 → 404 ──────────────────────────────────────────────────
  describe('GET /api/brain/task-router/diagnose/:kr_id', () => {
    it('KR 不存在时返回 404', async () => {
      // 查询 1: KR 不存在
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('不存在');
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });

    // ── KR 存在但没有 Initiative → 返回 no_initiatives blocker ────────
    it('KR 存在但没有 Initiative 时返回 no_initiatives blocker', async () => {
      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 无 initiative
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.kr_id).toBe(KR_ID);
      expect(res.body.kr_title).toBe('测试 KR');
      expect(res.body.initiatives).toEqual([]);
      expect(res.body.blockers).toHaveLength(1);
      expect(res.body.blockers[0].type).toBe('no_initiatives');
      expect(res.body.summary.total_initiatives).toBe(0);
      expect(res.body.summary.total_tasks).toBe(0);
      expect(res.body.summary.dispatchable_tasks).toBe(0);
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    // ── 完整诊断结果（有 initiative、有任务、有活动）───────────────────
    it('KR 存在时返回完整诊断结果（initiatives、tasks、recent_activity）', async () => {
      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 2 个 initiative
      mockPool.query.mockResolvedValueOnce({ rows: initiativeRows });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_A, status: 'queued', cnt: '3' },
          { project_id: INITIATIVE_ID_A, status: 'completed', cnt: '5' },
          { project_id: INITIATIVE_ID_B, status: 'queued', cnt: '1' },
          { project_id: INITIATIVE_ID_B, status: 'in_progress', cnt: '2' },
        ],
      });
      // 查询 4: queued 任务详情（4 个 queued，没有阻塞因素）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID_1, title: '任务1', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
            payload: {},
          },
          {
            id: TASK_ID_2, title: '任务2', status: 'queued', priority: 'P2',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z',
            payload: {},
          },
          {
            id: TASK_ID_3, title: '任务3', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-03T00:00:00Z', updated_at: '2026-03-03T00:00:00Z',
            payload: null,
          },
          {
            id: 'cccc0004-cccc-cccc-cccc-cccccccccccc', title: '任务4', status: 'queued', priority: 'P0',
            project_id: INITIATIVE_ID_B, goal_id: KR_ID,
            created_at: '2026-03-04T00:00:00Z', updated_at: '2026-03-04T00:00:00Z',
            payload: {},
          },
        ],
      });
      // 查询 5: 近 7 天派发记录（有活动）
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1); // 1 天前
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'eeee0001-eeee-eeee-eeee-eeeeeeeeeeee',
            title: '已完成任务',
            status: 'completed',
            project_id: INITIATIVE_ID_A,
            updated_at: recentDate.toISOString(),
          },
        ],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);

      // 基本字段
      expect(res.body.kr_id).toBe(KR_ID);
      expect(res.body.kr_title).toBe('测试 KR');
      expect(res.body.kr_status).toBe('active');
      expect(res.body.kr_progress).toBe(30);
      expect(res.body.kr_priority).toBe('P1');
      expect(res.body.since_days).toBe(7);

      // initiatives 详情
      expect(res.body.initiatives).toHaveLength(2);
      const initA = res.body.initiatives.find(i => i.id === INITIATIVE_ID_A);
      expect(initA.name).toBe('Initiative A');
      expect(initA.task_counts.queued).toBe(3);
      expect(initA.task_counts.completed).toBe(5);
      expect(initA.task_counts.total).toBe(8);
      expect(initA.queued_task_blockers).toHaveLength(0);

      const initB = res.body.initiatives.find(i => i.id === INITIATIVE_ID_B);
      expect(initB.task_counts.queued).toBe(1);
      expect(initB.task_counts.in_progress).toBe(2);
      expect(initB.task_counts.total).toBe(3);

      // blockers — Initiative B 状态为 paused 且有 queued 任务
      const initNotActiveBlocker = res.body.blockers.find(b => b.type === 'initiative_not_active');
      expect(initNotActiveBlocker).toBeDefined();
      expect(initNotActiveBlocker.count).toBe(1);

      // recent_activity
      expect(res.body.recent_activity).toHaveLength(1);
      expect(res.body.recent_activity[0].status).toBe('completed');

      // summary
      expect(res.body.summary.total_initiatives).toBe(2);
      expect(res.body.summary.total_tasks).toBe(11); // 8 + 3
      expect(res.body.summary.queued_tasks).toBe(4); // 3 + 1
      expect(res.body.summary.dispatchable_tasks).toBe(4); // 无阻塞
      expect(res.body.summary.blocked_tasks).toBe(0);
      expect(res.body.summary.has_blockers).toBe(true); // initiative_not_active blocker

      // 查询次数：KR + initiatives + taskCounts + queuedTasks + recentDispatch = 5
      expect(mockPool.query).toHaveBeenCalledTimes(5);
    });

    // ── 有阻塞任务（depends_on 未完成）───────────────────────────────────
    it('有阻塞任务（depends_on 未完成）时正确报告 blockers', async () => {
      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[0]],
      });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_A, status: 'queued', cnt: '2' },
          { project_id: INITIATIVE_ID_A, status: 'completed', cnt: '1' },
        ],
      });
      // 查询 4: queued 任务（1 个有 depends_on，1 个缺少 goal_id）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID_1, title: '有依赖的任务', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
            payload: { depends_on: [DEP_TASK_ID] },
          },
          {
            id: TASK_ID_2, title: '缺少 goal_id 的任务', status: 'queued', priority: 'P2',
            project_id: INITIATIVE_ID_A, goal_id: null,
            created_at: '2026-03-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z',
            payload: {},
          },
        ],
      });
      // 查询 5: depends_on 检查（1 个未完成的依赖）
      mockPool.query.mockResolvedValueOnce({
        rows: [{ cnt: '1' }],
      });
      // 查询 6: 近 7 天派发记录
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 7: 历史最近一次派发（无活动）
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);

      // initiatives 详情
      expect(res.body.initiatives).toHaveLength(1);
      const initA = res.body.initiatives[0];
      expect(initA.queued_task_blockers).toHaveLength(2);

      // 第一个 blocker: depends_on_incomplete
      const depBlocker = initA.queued_task_blockers.find(b => b.task_id === TASK_ID_1);
      expect(depBlocker).toBeDefined();
      expect(depBlocker.blockers).toContain('depends_on_incomplete:1/1');

      // 第二个 blocker: goal_id_missing
      const goalBlocker = initA.queued_task_blockers.find(b => b.task_id === TASK_ID_2);
      expect(goalBlocker).toBeDefined();
      expect(goalBlocker.blockers).toContain('goal_id_missing');

      // 全局 blockers
      const goalIdMissingBlocker = res.body.blockers.find(b => b.type === 'goal_id_missing');
      expect(goalIdMissingBlocker).toBeDefined();
      expect(goalIdMissingBlocker.count).toBe(1);

      const dependsOnBlocker = res.body.blockers.find(b => b.type === 'depends_on_incomplete');
      expect(dependsOnBlocker).toBeDefined();
      expect(dependsOnBlocker.count).toBe(1);

      // summary
      expect(res.body.summary.blocked_tasks).toBe(2);
      expect(res.body.summary.dispatchable_tasks).toBe(0); // 2 queued - 2 blocked
      expect(res.body.summary.last_dispatch_days_ago).toBeNull();

      // 查询次数：KR + initiatives + taskCounts + queuedTasks + depCheck + recentDispatch + historyCheck = 7
      expect(mockPool.query).toHaveBeenCalledTimes(7);
    });

    // ── 无任务队列的空结果 ───────────────────────────────────────────────
    it('Initiative 存在但没有任何任务时返回 no_tasks blocker', async () => {
      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[0]],
      });
      // 查询 3: 无任务状态统计
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 4: 无 queued 任务
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 5: 近 7 天无派发记录
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 6: 历史最近一次派发（无）
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.initiatives).toHaveLength(1);
      expect(res.body.initiatives[0].task_counts.total).toBe(0);
      expect(res.body.initiatives[0].task_counts.queued).toBe(0);
      expect(res.body.initiatives[0].queued_task_blockers).toHaveLength(0);

      // blockers
      const noTasksBlocker = res.body.blockers.find(b => b.type === 'no_tasks');
      expect(noTasksBlocker).toBeDefined();
      expect(noTasksBlocker.description).toContain('没有任何任务');

      // summary
      expect(res.body.summary.total_tasks).toBe(0);
      expect(res.body.summary.queued_tasks).toBe(0);
      expect(res.body.summary.dispatchable_tasks).toBe(0);
      expect(res.body.summary.last_dispatch_days_ago).toBeNull();

      expect(mockPool.query).toHaveBeenCalledTimes(6);
    });

    // ── 数据库错误 → 500 ────────────────────────────────────────────────
    it('数据库错误时返回 500', async () => {
      // 查询 1: 数据库抛出异常
      mockPool.query.mockRejectedValueOnce(new Error('连接超时'));

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('诊断失败');
      expect(res.body.details).toBe('连接超时');
    });

    // ── next_run_at 设置为未来时间 ──────────────────────────────────────
    it('next_run_at 设置为未来时间时报告 next_run_at_delayed blocker', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 24); // 24 小时后

      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[0]],
      });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_A, status: 'queued', cnt: '1' },
        ],
      });
      // 查询 4: queued 任务（有 next_run_at 为未来时间）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID_1, title: '延迟任务', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
            payload: { next_run_at: futureDate.toISOString() },
          },
        ],
      });
      // 查询 5: 近 7 天派发记录
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 6: 历史最近一次派发
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);

      // blocker 检查
      const nextRunBlocker = res.body.blockers.find(b => b.type === 'next_run_at_delayed');
      expect(nextRunBlocker).toBeDefined();
      expect(nextRunBlocker.count).toBe(1);

      // Initiative 级别 blocker 详情
      const initA = res.body.initiatives[0];
      expect(initA.queued_task_blockers).toHaveLength(1);
      expect(initA.queued_task_blockers[0].blockers[0]).toMatch(/^next_run_at_future:\+\d+h$/);

      expect(res.body.summary.blocked_tasks).toBe(1);
      expect(res.body.summary.dispatchable_tasks).toBe(0);
    });

    // ── since_days 自定义查询参数 ───────────────────────────────────────
    it('支持自定义 since_days 查询参数', async () => {
      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[0]],
      });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_A, status: 'completed', cnt: '5' },
        ],
      });
      // 查询 4: 无 queued 任务
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 5: 近 N 天派发记录
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 6: 历史最近一次派发（30 天前）
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_updated: oldDate.toISOString() }],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}?since_days=14`);

      expect(res.status).toBe(200);
      expect(res.body.since_days).toBe(14);

      // 确认第 5 次查询传了 since_days=14
      const recentDispatchCall = mockPool.query.mock.calls[4];
      expect(recentDispatchCall[1][1]).toBe(14); // parseInt('14')

      // long_inactivity blocker（30 天 > 14 天）
      const inactivityBlocker = res.body.blockers.find(b => b.type === 'long_inactivity');
      expect(inactivityBlocker).toBeDefined();
      expect(inactivityBlocker.days_ago).toBeGreaterThanOrEqual(29);

      // no_queued_tasks blocker
      const noQueuedBlocker = res.body.blockers.find(b => b.type === 'no_queued_tasks');
      expect(noQueuedBlocker).toBeDefined();
    });

    // ── 多个阻塞因素组合 ────────────────────────────────────────────────
    it('多个阻塞因素组合时全部报告', async () => {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 48);

      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative (paused)
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[1]], // status: 'paused'
      });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_B, status: 'queued', cnt: '2' },
        ],
      });
      // 查询 4: 2 个 queued 任务（一个缺 goal_id + next_run_at 未来，一个有 depends_on）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID_1, title: '多重阻塞', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_B, goal_id: null,
            created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
            payload: { next_run_at: futureDate.toISOString() },
          },
          {
            id: TASK_ID_2, title: '依赖阻塞', status: 'queued', priority: 'P2',
            project_id: INITIATIVE_ID_B, goal_id: KR_ID,
            created_at: '2026-03-02T00:00:00Z', updated_at: '2026-03-02T00:00:00Z',
            payload: { depends_on: [DEP_TASK_ID, 'dddd0002-dddd-dddd-dddd-dddddddddddd'] },
          },
        ],
      });
      // 查询 5: depends_on 检查（2 个依赖中 1 个未完成）
      mockPool.query.mockResolvedValueOnce({
        rows: [{ cnt: '1' }],
      });
      // 查询 6: 近 7 天无派发
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // 查询 7: 历史最近一次（无）
      mockPool.query.mockResolvedValueOnce({
        rows: [{ last_updated: null }],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);

      // 验证所有类型的 blocker 都存在
      const blockerTypes = res.body.blockers.map(b => b.type);
      expect(blockerTypes).toContain('goal_id_missing');
      expect(blockerTypes).toContain('next_run_at_delayed');
      expect(blockerTypes).toContain('depends_on_incomplete');
      expect(blockerTypes).toContain('initiative_not_active');

      // 第一个任务有两个阻塞原因
      const initB = res.body.initiatives[0];
      const multiBlocker = initB.queued_task_blockers.find(b => b.task_id === TASK_ID_1);
      expect(multiBlocker.blockers).toContain('goal_id_missing');
      expect(multiBlocker.blockers.some(r => r.startsWith('next_run_at_future'))).toBe(true);

      // summary
      expect(res.body.summary.blocked_tasks).toBe(2);
      expect(res.body.summary.dispatchable_tasks).toBe(0);
    });

    // ── 数据库在中间步骤出错 → 500 ─────────────────────────────────────
    it('数据库在查询 initiative 步骤出错时返回 500', async () => {
      // 查询 1: KR 存在
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 数据库异常
      mockPool.query.mockRejectedValueOnce(new Error('查询 Initiative 失败'));

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('诊断失败');
      expect(res.body.details).toBe('查询 Initiative 失败');
    });

    // ── 近期有派发活动时 last_dispatch_days_ago 正确计算 ─────────────────
    it('近期有派发活动时 last_dispatch_days_ago 正确计算（不查历史）', async () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      // 查询 1: KR 信息
      mockPool.query.mockResolvedValueOnce({ rows: [krRow] });
      // 查询 2: 1 个 initiative
      mockPool.query.mockResolvedValueOnce({
        rows: [initiativeRows[0]],
      });
      // 查询 3: 任务状态统计
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { project_id: INITIATIVE_ID_A, status: 'queued', cnt: '1' },
          { project_id: INITIATIVE_ID_A, status: 'completed', cnt: '3' },
        ],
      });
      // 查询 4: 1 个 queued 任务（无阻塞）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: TASK_ID_1, title: '正常任务', status: 'queued', priority: 'P1',
            project_id: INITIATIVE_ID_A, goal_id: KR_ID,
            created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z',
            payload: {},
          },
        ],
      });
      // 查询 5: 近 7 天派发记录（有活动 → 不触发查询 6）
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'eeee0001-eeee-eeee-eeee-eeeeeeeeeeee',
            title: '2天前完成的任务',
            status: 'completed',
            project_id: INITIATIVE_ID_A,
            updated_at: twoDaysAgo.toISOString(),
          },
        ],
      });

      const res = await request(app)
        .get(`/api/brain/task-router/diagnose/${KR_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.summary.last_dispatch_days_ago).toBe(2);
      // 有近期活动，不查历史 → 只有 5 次查询
      expect(mockPool.query).toHaveBeenCalledTimes(5);
      // 不应有 long_inactivity blocker（2 天 < 7 天）
      expect(res.body.blockers.find(b => b.type === 'long_inactivity')).toBeUndefined();
    });
  });
});
