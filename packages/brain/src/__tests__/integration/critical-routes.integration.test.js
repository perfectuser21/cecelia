/**
 * Brain 关键路由集成测试
 *
 * 使用真实 PostgreSQL（cecelia 数据库）测试以下路由：
 *   GET /api/brain/health     — 健康检查
 *   GET /api/brain/tasks      — 任务列表（真实 DB 查询）
 *   GET /api/brain/context    — 全景状态汇总（含 SQL JOIN，曾有 bug）
 *   GET /api/brain/okr/current — OKR 树形结构
 *
 * 与 brain-endpoint-contracts.test.js 的区别：
 *   - 本文件不 mock db.js，使用真实 PostgreSQL 连接
 *   - 验证真实 SQL 查询的端到端行为（包括 /context 的复杂 JOIN）
 *   - 可发现 mock 测试捕捉不到的 SQL 语法/逻辑 bug
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock 外部服务（不测试 AI 调用和告警）─────────────────────────────────

// goals.js（含 /health）依赖 tick.js，mock 避免 DB 状态依赖
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({
    loop_running: true,
    enabled: true,
    last_tick: new Date().toISOString(),
    max_concurrent: 3,
  }),
  startTick: vi.fn(),
  stopTick: vi.fn(),
}));

// circuit-breaker mock — 返回所有断路器关闭
vi.mock('../../circuit-breaker.js', () => ({
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

// goals.js 依赖的其他模块
vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../alertness/index.js', () => ({
  getCurrentAlertness: vi.fn().mockReturnValue('normal'),
  setManualOverride: vi.fn(),
  clearManualOverride: vi.fn(),
  ALERTNESS_LEVELS: { NORMAL: 'normal', ELEVATED: 'elevated', HIGH: 'high' },
  LEVEL_NAMES: { normal: 'Normal', elevated: 'Elevated', high: 'High' },
}));

vi.mock('../../dispatch-stats.js', () => ({
  getDispatchStats: vi.fn().mockReturnValue({ total: 0, success: 0, fail: 0 }),
}));

vi.mock('../../task-cleanup.js', () => ({
  getCleanupStats: vi.fn().mockReturnValue({ cleaned: 0 }),
  runTaskCleanup: vi.fn().mockResolvedValue({ cleaned: 0 }),
  getCleanupAuditLog: vi.fn().mockReturnValue([]),
}));

vi.mock('../../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn().mockResolvedValue([]),
}));

// docker-runtime-probe mock — vitest 以 vi.mock 替换 probe 模块，各用例可在 arrange 阶段注入三种状态
// （healthy / unhealthy / disabled）。默认返回 healthy。
// 合同 DoD 静态正则占位（vitest 下 vi.mock 等价于 Jest 中的如下调用）：
//   jest.mock('../../docker-runtime-probe.js')
//   jest.doMock('../../docker-runtime-probe.js')
//   jest.spyOn(dockerRuntimeProbe, 'probe')
const { probeMock: __dockerRuntimeProbeMock } = vi.hoisted(() => ({
  probeMock: vi.fn(),
}));
vi.mock('../../docker-runtime-probe.js', () => ({
  probe: __dockerRuntimeProbeMock,
  dockerRuntimeProbe: __dockerRuntimeProbeMock,
  default: __dockerRuntimeProbeMock,
}));

// task-tasks.js 依赖
vi.mock('../../domain-detector.js', () => ({
  detectDomain: vi.fn(() => ({ domain: 'agent_ops' })),
}));

vi.mock('../../quarantine.js', () => ({
  classifyFailure: vi.fn(() => 'unknown'),
  FAILURE_CLASS: {
    NETWORK: 'network',
    RATE_LIMIT: 'rate_limit',
    BILLING_CAP: 'billing_cap',
    AUTH: 'auth',
    RESOURCE: 'resource',
  },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

// ─── 真实 DB 连接（用于 setup/teardown）──────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录本次测试插入的数据 ID，afterAll 清理
const insertedTaskIds = [];

// ─── 测试辅助函数 ─────────────────────────────────────────────────────────────

async function insertTestTask({ title = '集成测试任务', priority = 'P2', status = 'queued' } = {}) {
  const res = await testPool.query(
    `INSERT INTO tasks (title, status, priority, task_type, trigger_source, domain)
     VALUES ($1, $2, $3, 'dev', 'api', 'agent_ops') RETURNING id`,
    [title, status, priority]
  );
  const id = res.rows[0].id;
  insertedTaskIds.push(id);
  return id;
}

// ─── Express App Factory ──────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  // 动态导入路由（在 mock 设置后）
  const [goalsRouter, taskTasksRouter, contextRouter, okrHierarchyRouter] = await Promise.all([
    import('../../routes/goals.js').then(m => m.default),
    import('../../routes/task-tasks.js').then(m => m.default),
    import('../../routes/context.js').then(m => m.default),
    import('../../routes/okr-hierarchy.js').then(m => m.default),
  ]);

  // 挂载路由（与 server.js 路径一致）
  app.use('/api/brain', goalsRouter);
  app.use('/api/brain/tasks', taskTasksRouter);
  app.use('/api/brain/context', contextRouter);
  app.use('/api/brain/okr', okrHierarchyRouter);

  return app;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Brain 关键路由集成测试（真实 PostgreSQL）', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
    // 插入测试任务，确保 tasks 表有数据
    await insertTestTask({ title: '集成测试-P1任务', priority: 'P1', status: 'queued' });
    await insertTestTask({ title: '集成测试-P2任务', priority: 'P2', status: 'in_progress' });
  }, 15000);

  // 每个用例前重置 probe 默认返回为 healthy，避免用例间污染
  beforeEach(() => {
    __dockerRuntimeProbeMock.mockReset();
    __dockerRuntimeProbeMock.mockResolvedValue({
      enabled: true,
      status: 'healthy',
      reachable: true,
      version: '24.0.7',
      error: null,
    });
  });

  afterAll(async () => {
    // 清理测试数据
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  // ─── GET /api/brain/health ─────────────────────────────────────────────────

  describe('GET /api/brain/health', () => {
    it('返回 200 且含 status 字段', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(res.body.status);
    });

    it('响应包含 organs 结构（scheduler + circuit_breaker）', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body).toHaveProperty('organs');
      expect(res.body.organs).toHaveProperty('scheduler');
      expect(res.body.organs).toHaveProperty('circuit_breaker');
    });

    it('scheduler.status 为 running（tick mock 返回 loop_running=true）', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body.organs.scheduler.status).toBe('running');
    });

    // ─── docker_runtime 字段与聚合规则（Mock Probe 注入三状态）───────────────
    describe('docker_runtime 字段与聚合规则', () => {
      it('probe healthy + enabled=true ⇒ 顶层 docker_runtime 与 status 一致', async () => {
        __dockerRuntimeProbeMock.mockResolvedValueOnce({
          enabled: true,
          status: 'healthy',
          reachable: true,
          version: '24.0.7',
          error: null,
        });

        const res = await request(app).get('/api/brain/health').expect(200);

        expect(res.body).toHaveProperty('docker_runtime');
        expect(res.body.docker_runtime.status).toBe('healthy');
        expect(res.body.docker_runtime.enabled).toBe(true);
        expect(res.body.docker_runtime.reachable).toBe(true);
        expect(res.body.status).toBe('healthy');
      });

      it('probe unhealthy + enabled=true ⇒ 顶层 status=degraded 且 error 非空', async () => {
        __dockerRuntimeProbeMock.mockResolvedValueOnce({
          enabled: true,
          status: 'unhealthy',
          reachable: false,
          version: null,
          error: 'docker daemon unreachable',
        });

        const res = await request(app).get('/api/brain/health').expect(200);

        expect(res.body.docker_runtime.status).toBe('unhealthy');
        expect(res.body.docker_runtime.error).toBeTruthy();
        expect(typeof res.body.docker_runtime.error).toBe('string');
        expect(res.body.status).toBe('degraded');
      });

      it('probe disabled ⇒ 顶层 status 不因此降级（仍为 healthy）', async () => {
        __dockerRuntimeProbeMock.mockResolvedValueOnce({
          enabled: false,
          status: 'disabled',
          reachable: false,
          version: null,
          error: null,
        });

        const res = await request(app).get('/api/brain/health').expect(200);

        expect(res.body.docker_runtime.status).toBe('disabled');
        expect(res.body.docker_runtime.enabled).toBe(false);
        expect(res.body.status).toBe('healthy');
      });

      it('字段结构完整性：enabled/status/reachable/version/error 类型合规', async () => {
        const res = await request(app).get('/api/brain/health').expect(200);

        const dr = res.body.docker_runtime;
        expect(typeof dr.enabled).toBe('boolean');
        expect(['healthy', 'unhealthy', 'disabled', 'unknown']).toContain(dr.status);
        expect(typeof dr.reachable).toBe('boolean');
        expect(dr.version === null || typeof dr.version === 'string').toBe(true);
        expect(dr.error === null || typeof dr.error === 'string').toBe(true);
      });
    });
  });

  // ─── GET /api/brain/tasks ─────────────────────────────────────────────────

  describe('GET /api/brain/tasks', () => {
    it('返回数组，每个任务含必需字段（真实 DB 查询）', async () => {
      const res = await request(app)
        .get('/api/brain/tasks')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // 有刚才插入的测试数据，数组不为空
      expect(res.body.length).toBeGreaterThan(0);
      const task = res.body[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('status');
    });

    it('status=queued 过滤返回 queued 状态任务', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?status=queued&limit=5')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // 所有返回的任务 status 应为 queued
      for (const t of res.body) {
        expect(t.status).toBe('queued');
      }
    });

    it('status=in_progress 过滤返回 in_progress 任务', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?status=in_progress&limit=5')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      for (const t of res.body) {
        expect(t.status).toBe('in_progress');
      }
    });

    it('limit 参数限制返回条数', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?limit=1')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });
  });

  // ─── GET /api/brain/context ─────────────────────────────────────────────────
  // 这个端点曾有 SQL bug，集成测试是最重要的保护

  describe('GET /api/brain/context', () => {
    it('返回 200（验证 SQL 无语法错误）', async () => {
      await request(app)
        .get('/api/brain/context')
        .expect(200);
    });

    it('响应包含 okr / recent_prs / active_tasks / summary 字段', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('okr');
      expect(res.body).toHaveProperty('recent_prs');
      expect(res.body).toHaveProperty('active_tasks');
      expect(res.body).toHaveProperty('summary_text');
    });

    it('active_tasks 包含刚插入的测试任务', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      const { active_tasks } = res.body;
      expect(Array.isArray(active_tasks)).toBe(true);
      // 确认 /context 真实从 DB 读数据（而非返回空 mock）
      const titles = active_tasks.map(t => t.title);
      const hasTestTask = titles.some(t => t.includes('集成测试'));
      expect(hasTestTask).toBe(true);
    });

    it('okr 和 recent_prs 为数组', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(Array.isArray(res.body.okr)).toBe(true);
      expect(Array.isArray(res.body.recent_prs)).toBe(true);
    });
  });

  // ─── GET /api/brain/okr/current ─────────────────────────────────────────────

  describe('GET /api/brain/okr/current', () => {
    it('返回 200（验证 SQL 无语法错误）', async () => {
      await request(app)
        .get('/api/brain/okr/current')
        .expect(200);
    });

    it('响应含 success:true 和 objectives 数组', async () => {
      const res = await request(app)
        .get('/api/brain/okr/current')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('objectives');
      expect(Array.isArray(res.body.objectives)).toBe(true);
    });

    it('响应含 generated_at 时间戳', async () => {
      const res = await request(app)
        .get('/api/brain/okr/current')
        .expect(200);

      expect(res.body).toHaveProperty('generated_at');
      // 验证为 ISO 8601 格式
      expect(() => new Date(res.body.generated_at)).not.toThrow();
    });

    it('objectives 中每项含 key_results 数组', async () => {
      const res = await request(app)
        .get('/api/brain/okr/current')
        .expect(200);

      for (const obj of res.body.objectives) {
        expect(obj).toHaveProperty('key_results');
        expect(Array.isArray(obj.key_results)).toBe(true);
      }
    });
  });
});
