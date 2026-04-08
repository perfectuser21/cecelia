/**
 * Cross-Package Brain API 集成测试
 *
 * 真实 HTTP 调用 Brain 核心端点（启动测试 server），验证跨包接口合约：
 *
 * 1. GET /api/brain/context — 返回 okr + active_tasks + recent_prs + summary_text 四个字段
 * 2. GET /api/brain/tasks — 支持 status / task_type / limit 三个过滤参数
 *    - status 过滤正确
 *    - task_type 过滤正确
 *    - limit 正确截断结果数量
 * 3. POST /api/brain/memory/search — 接受 POST + query 参数
 *    - 缺少 query 时返回 400
 *    - 有效 query 时返回 matches 数组
 *
 * 使用真实 PostgreSQL，测试完毕后清理所有插入数据。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock 外部依赖 ────────────────────────────────────────────────────────────

vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({ loop_running: true, enabled: true }),
  startTick: vi.fn(),
  stopTick: vi.fn(),
  check48hReport: vi.fn(),
}));

vi.mock('../../circuit-breaker.js', () => ({
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

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

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

// memory/search 依赖的 similarity + openai
vi.mock('../../similarity.js', () => ({
  default: class MockSimilarityService {
    constructor(_pool) {}
    async searchWithVectors(_query, _opts) {
      return {
        matches: [
          { id: 'mock-1', level: 'task', title: 'Mock Result', score: 0.85, description: 'Mock description' },
        ],
      };
    }
    async search(_query, _opts) { return { matches: [] }; }
  },
}));

vi.mock('../../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// ─── 真实 DB 连接池 ──────────────────────────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const insertedTaskIds = [];

// ─── Express App 工厂（模拟 apps/api 视角调用 Brain）────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const [taskRouter, contextRouter, memoryRouter] = await Promise.all([
    import('../../routes/task-tasks.js').then(m => m.default),
    import('../../routes/context.js').then(m => m.default),
    import('../../routes/memory.js').then(m => m.default),
  ]);

  // 与 server.js 挂载路径一致
  app.use('/api/brain/tasks', taskRouter);
  app.use('/api/brain/context', contextRouter);
  app.use('/api/brain/memory', memoryRouter);

  return app;
}

// ─── 辅助：创建测试任务 ───────────────────────────────────────────────────────

async function createTestTask(app, overrides = {}) {
  const res = await request(app)
    .post('/api/brain/tasks')
    .send({
      title: '[cross-package-test] 测试任务',
      description: 'Cross-Package API 集成测试自动创建，测试完毕后自动清理',
      task_type: 'dev',
      priority: 'P2',
      trigger_source: 'api',
      ...overrides,
    })
    .expect(201);

  insertedTaskIds.push(res.body.id);
  return res.body;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('Cross-Package Brain API — 核心端点合约验证（真实 PostgreSQL）', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
  }, 20000);

  afterAll(async () => {
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 接口 1: GET /api/brain/context
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/brain/context — 全景状态汇总接口', () => {
    it('端点存在，返回 200 + success:true', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
    });

    it('返回 okr 数组字段', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('okr');
      expect(Array.isArray(res.body.okr)).toBe(true);
    });

    it('返回 active_tasks 数组字段', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('active_tasks');
      expect(Array.isArray(res.body.active_tasks)).toBe(true);
    });

    it('返回 recent_prs 数组字段', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('recent_prs');
      expect(Array.isArray(res.body.recent_prs)).toBe(true);
    });

    it('返回 summary_text 字符串字段（Claude 可直读）', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('summary_text');
      expect(typeof res.body.summary_text).toBe('string');
      expect(res.body.summary_text.length).toBeGreaterThan(0);
    });

    it('返回 generated_at 时间戳字段', async () => {
      const res = await request(app)
        .get('/api/brain/context')
        .expect(200);

      expect(res.body).toHaveProperty('generated_at');
      expect(new Date(res.body.generated_at).getTime()).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 接口 2: GET /api/brain/tasks — 三个过滤参数验证
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /api/brain/tasks — status / task_type / limit 三个过滤参数', () => {
    let queuedDevTaskId;
    let inProgressAnalysisTaskId;

    beforeAll(async () => {
      // 创建两个不同 status 和 task_type 的任务
      const devTask = await createTestTask(app, {
        title: '[cross-package-test] queued dev 任务',
        task_type: 'dev',
        priority: 'P2',
      });
      queuedDevTaskId = devTask.id;

      const analysisTask = await createTestTask(app, {
        title: '[cross-package-test] research 任务',
        task_type: 'research',
        priority: 'P2',
      });
      inProgressAnalysisTaskId = analysisTask.id;

      // 更新 research 任务为 in_progress
      await request(app)
        .patch(`/api/brain/tasks/${inProgressAnalysisTaskId}`)
        .send({ status: 'in_progress' })
        .expect(200);
    });

    it('status=queued 过滤：返回数组，包含刚创建的 dev 任务', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?status=queued&limit=100')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map(t => t.id);
      expect(ids).toContain(queuedDevTaskId);
      // in_progress 任务不应在 queued 过滤结果中
      expect(ids).not.toContain(inProgressAnalysisTaskId);
    });

    it('status=in_progress 过滤：返回数组，包含 in_progress 的 research 任务', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?status=in_progress&limit=100')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map(t => t.id);
      expect(ids).toContain(inProgressAnalysisTaskId);
      // queued 任务不应在 in_progress 过滤结果中
      expect(ids).not.toContain(queuedDevTaskId);
    });

    it('task_type=dev 过滤：所有结果都是 dev 类型', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?task_type=dev&limit=50')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const taskTypes = res.body.map(t => t.task_type);
      expect(taskTypes.every(tt => tt === 'dev')).toBe(true);
    });

    it('task_type=research 过滤：所有结果都是 research 类型', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?task_type=research&limit=50')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const taskTypes = res.body.map(t => t.task_type);
      expect(taskTypes.every(tt => tt === 'research')).toBe(true);
    });

    it('limit=1 截断结果：返回数组长度 <= 1', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?limit=1')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(1);
    });

    it('limit=5 截断结果：返回数组长度 <= 5', async () => {
      const res = await request(app)
        .get('/api/brain/tasks?limit=5')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 接口 3: POST /api/brain/memory/search — query 参数验证
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /api/brain/memory/search — 接受 POST + query 参数', () => {
    it('缺少 query 参数时返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/memory/search')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('query 为空字符串时返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: '' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('query 为数字（非字符串）时返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: 42 })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('有效 query 时返回 200 + matches 数组', async () => {
      const res = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: 'Brain 任务调度' })
        .expect(200);

      expect(res.body).toHaveProperty('matches');
      expect(Array.isArray(res.body.matches)).toBe(true);
    });

    it('有效 query + topK 参数时返回正确结构', async () => {
      const res = await request(app)
        .post('/api/brain/memory/search')
        .send({ query: 'deploy rollback', topK: 3 })
        .expect(200);

      expect(res.body).toHaveProperty('matches');
      expect(Array.isArray(res.body.matches)).toBe(true);
    });
  });
});
