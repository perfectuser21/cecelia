/**
 * Golden Path E2E 集成测试
 *
 * 覆盖 Cecelia Brain 最核心的 3 条用户路径（任何一条断了都是 P0）：
 *
 * Path 1: Brain 基础调度链路
 *   tasks 表可读写 → POST 创建任务 → GET 查询验证 → PATCH 更新状态 → 数据清理
 *
 * Path 2: 内容流水线触发链路
 *   POST /api/brain/pipelines 触发 → pipeline 记录写入 DB tasks 表 → GET 可查询到该记录
 *   （注：content-pipeline 路由需要 content_type 在注册表中存在，此处用 mock 绕过注册表校验）
 *
 * Path 3: Deploy 链路完整性
 *   GET /api/brain/health 端点存在且响应正常（含 status 字段）
 *   GET /api/brain/deploy/status 端点存在且响应正常（含 status 字段）
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 * 不 mock db.js，直接使用真实 PostgreSQL 连接验证端到端行为。
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock 外部依赖（不测 AI 调用和告警，只测路由 + DB 链路）────────────────

vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({
    loop_running: true,
    enabled: true,
    last_tick: new Date().toISOString(),
    max_concurrent: 3,
  }),
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

vi.mock('../../proposal.js', () => ({
  createProposal: vi.fn(),
  approveProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getProposal: vi.fn(),
  listProposals: vi.fn().mockResolvedValue([]),
}));

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

// Path 2: content-pipeline 依赖的注册表 mock
vi.mock('../../content-types/content-type-registry.js', () => ({
  listContentTypes: vi.fn().mockResolvedValue(['golden-path-test-type']),
  getContentType: vi.fn().mockResolvedValue({ notebook_id: null }),
  getContentTypeFromYaml: vi.fn().mockReturnValue(null),
  listContentTypesFromYaml: vi.fn().mockReturnValue([]),
}));

// content-pipeline 依赖的 orchestrator/scheduler mock
vi.mock('../../content-pipeline-orchestrator.js', () => ({
  orchestrateContentPipelines: vi.fn().mockResolvedValue([]),
  executeQueuedContentTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../topic-selection-scheduler.js', () => ({
  triggerDailyTopicSelection: vi.fn().mockResolvedValue({ triggered: false }),
  hasTodayTopics: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn(),
  callLLMStream: vi.fn(),
}));

// ops.js 依赖的 mock
vi.mock('../../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../../orchestrator-chat.js', () => ({
  handleChat: vi.fn(),
}));

vi.mock('../../task-weight.js', () => ({
  getTaskWeights: vi.fn(),
}));

vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));

vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

vi.mock('../../suggestion-triage.js', () => ({
  createSuggestion: vi.fn(),
  executeTriage: vi.fn(),
  getTopPrioritySuggestions: vi.fn(),
  updateSuggestionStatus: vi.fn(),
  cleanupExpiredSuggestions: vi.fn(),
  getTriageStats: vi.fn(),
}));

vi.mock('../../decomposition-checker.js', () => ({
  runDecompositionChecks: vi.fn(),
}));

vi.mock('../../pr-callback-handler.js', () => ({
  verifyWebhookSignature: vi.fn(),
  extractPrInfo: vi.fn(),
  handlePrMerged: vi.fn(),
}));

vi.mock('./shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn(),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));

vi.mock('child_process', () => ({ exec: vi.fn(), execSync: vi.fn() }));

// docker-runtime-probe mock — 以 vi.mock 替换 probe 模块，用例可按需注入三种状态
// （healthy / unhealthy / disabled），断言顶层 status 聚合 degraded。
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

// ─── 真实 DB 连接池（用于直接验证写入）─────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录本次测试插入的数据 ID，afterAll 统一清理
const insertedTaskIds = [];

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const [taskTasksRouter, contentPipelineRouter, goalsRouter, opsRouter] = await Promise.all([
    import('../../routes/task-tasks.js').then(m => m.default),
    import('../../routes/content-pipeline.js').then(m => m.default),
    import('../../routes/goals.js').then(m => m.default),
    import('../../routes/ops.js').then(m => m.default),
  ]);

  // 与 server.js 挂载路径一致
  app.use('/api/brain/tasks', taskTasksRouter);
  app.use('/api/brain/pipelines', contentPipelineRouter);
  app.use('/api/brain', goalsRouter);
  app.use('/api/brain', opsRouter);

  return app;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('Golden Path E2E — Brain 3 条核心链路（真实 PostgreSQL）', () => {
  let app;

  beforeAll(async () => {
    app = await makeApp();
  }, 20000);

  // 每个用例前重置 probe 默认返回为 healthy，防止跨用例污染
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
    // 清理本次测试写入的所有数据
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Path 1: Brain 基础调度链路
  // tasks 表可读写 → 创建 → 查询 → 更新状态
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Path 1: Brain 基础调度链路', () => {
    let createdTaskId;

    it('POST /api/brain/tasks — 创建任务写入 DB，返回 201 + task id', async () => {
      const res = await request(app)
        .post('/api/brain/tasks')
        .send({
          title: '[golden-path] Brain 调度链路测试任务',
          description: 'Golden Path E2E 测试自动创建，测试完毕后自动清理',
          task_type: 'dev',
          priority: 'P2',
          trigger_source: 'api',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toContain('golden-path');
      expect(res.body.status).toBe('queued');
      expect(res.body.task_type).toBe('dev');

      createdTaskId = res.body.id;
      insertedTaskIds.push(createdTaskId);
    });

    it('GET /api/brain/tasks/:id — 刚创建的任务可通过 ID 查询到', async () => {
      expect(createdTaskId).toBeDefined();

      const res = await request(app)
        .get(`/api/brain/tasks/${createdTaskId}`)
        .expect(200);

      expect(res.body.id).toBe(createdTaskId);
      expect(res.body.title).toContain('golden-path');
      expect(res.body.status).toBe('queued');
    });

    it('GET /api/brain/tasks — 任务列表包含刚创建的任务', async () => {
      expect(createdTaskId).toBeDefined();

      const res = await request(app)
        .get('/api/brain/tasks?status=queued&limit=50')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map(t => t.id);
      expect(ids).toContain(createdTaskId);
    });

    it('PATCH /api/brain/tasks/:id — 更新任务状态为 in_progress，DB 中状态同步', async () => {
      expect(createdTaskId).toBeDefined();

      const res = await request(app)
        .patch(`/api/brain/tasks/${createdTaskId}`)
        .send({ status: 'in_progress' })
        .expect(200);

      expect(res.body.id).toBe(createdTaskId);
      expect(res.body.status).toBe('in_progress');

      // 直接查 DB 验证持久化
      const dbRes = await testPool.query('SELECT status FROM tasks WHERE id = $1', [createdTaskId]);
      expect(dbRes.rows[0].status).toBe('in_progress');
    });

    it('PATCH /api/brain/tasks/:id — 更新为 completed + metadata 字段', async () => {
      expect(createdTaskId).toBeDefined();

      const res = await request(app)
        .patch(`/api/brain/tasks/${createdTaskId}`)
        .send({ status: 'completed', pr_url: 'https://github.com/test/pr/1' })
        .expect(200);

      expect(res.body.status).toBe('completed');

      // 直接查 DB 验证状态持久化（tasks 表用 status / pr_url 字段存储完成信息）
      const dbRes = await testPool.query(
        'SELECT status, pr_url FROM tasks WHERE id = $1',
        [createdTaskId]
      );
      expect(dbRes.rows[0].status).toBe('completed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Path 2: 内容流水线触发链路
  // POST /api/brain/pipelines → 写入 tasks 表 → GET 可查询
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Path 2: 内容流水线触发链路', () => {
    let createdPipelineId;

    it('POST /api/brain/pipelines — 触发 pipeline，DB 写入 content-pipeline 任务，返回 id', async () => {
      const res = await request(app)
        .post('/api/brain/pipelines')
        .send({
          keyword: 'golden-path-smoke-test',
          content_type: 'golden-path-test-type',
          priority: 'P2',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toContain('golden-path-smoke-test');

      createdPipelineId = res.body.id;
      insertedTaskIds.push(createdPipelineId);
    });

    it('GET /api/brain/pipelines — 列表包含刚创建的 pipeline 记录', async () => {
      expect(createdPipelineId).toBeDefined();

      const res = await request(app)
        .get('/api/brain/pipelines')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map(t => t.id);
      expect(ids).toContain(createdPipelineId);
    });

    it('DB 中 pipeline 任务 task_type = content-pipeline', async () => {
      expect(createdPipelineId).toBeDefined();

      const dbRes = await testPool.query(
        'SELECT task_type, status, payload FROM tasks WHERE id = $1',
        [createdPipelineId]
      );

      expect(dbRes.rows).toHaveLength(1);
      expect(dbRes.rows[0].task_type).toBe('content-pipeline');
      expect(dbRes.rows[0].status).toBe('queued');

      // payload 包含 keyword 和 content_type
      const payload = dbRes.rows[0].payload;
      expect(payload.keyword).toBe('golden-path-smoke-test');
      expect(payload.content_type).toBe('golden-path-test-type');
    });

    it('POST /api/brain/pipelines — 缺少 keyword 返回 400', async () => {
      const res = await request(app)
        .post('/api/brain/pipelines')
        .send({ content_type: 'golden-path-test-type' })
        .expect(400);

      expect(res.body).toHaveProperty('error');
    });

    it('POST /api/brain/pipelines — 未知 content_type 返回 400', async () => {
      const { listContentTypes } = await import('../../content-types/content-type-registry.js');
      listContentTypes.mockResolvedValueOnce(['golden-path-test-type']);

      const res = await request(app)
        .post('/api/brain/pipelines')
        .send({ keyword: 'test', content_type: 'nonexistent-type' })
        .expect(400);

      expect(res.body.error).toContain('nonexistent-type');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Path 3: Deploy 链路完整性
  // health 端点 + deploy/status 端点存在且响应正常
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Path 3: Deploy 链路完整性', () => {
    it('GET /api/brain/health — 端点存在，返回 200 + status 字段', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(['healthy', 'degraded']).toContain(res.body.status);
    });

    it('GET /api/brain/health — 包含 organs 结构（scheduler + circuit_breaker）', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body).toHaveProperty('organs');
      expect(res.body.organs).toHaveProperty('scheduler');
      expect(res.body.organs).toHaveProperty('circuit_breaker');
    });

    it('GET /api/brain/health — scheduler.status 为 running', async () => {
      const res = await request(app)
        .get('/api/brain/health')
        .expect(200);

      expect(res.body.organs.scheduler.status).toBe('running');
    });

    // ─── docker_runtime 字段与三状态聚合（Mock Probe 注入）─────────────────
    it('GET /api/brain/health — docker_runtime healthy 时字段就位，顶层 status=healthy', async () => {
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

    it('GET /api/brain/health — docker_runtime unhealthy+enabled ⇒ 顶层 status=degraded', async () => {
      __dockerRuntimeProbeMock.mockResolvedValueOnce({
        enabled: true,
        status: 'unhealthy',
        reachable: false,
        version: null,
        error: 'docker daemon unreachable',
      });

      const res = await request(app).get('/api/brain/health').expect(200);

      expect(res.body.docker_runtime.status).toBe('unhealthy');
      expect(typeof res.body.docker_runtime.error).toBe('string');
      expect(res.body.docker_runtime.error.length).toBeGreaterThan(0);
      expect(res.body.status).toBe('degraded');
    });

    it('GET /api/brain/health — docker_runtime disabled ⇒ 顶层 status 不降级', async () => {
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

    it('GET /api/brain/deploy/status — 端点存在，返回 200 + status 字段', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/status')
        .expect(200);

      expect(res.body).toHaveProperty('status');
      const validStatuses = ['idle', 'running', 'success', 'failed'];
      expect(validStatuses).toContain(res.body.status);
    });

    it('GET /api/brain/deploy/status — 初始状态为 idle（无部署进行中）', async () => {
      const res = await request(app)
        .get('/api/brain/deploy/status')
        .expect(200);

      // 默认状态为 idle，CI 环境下不应有正在进行的部署
      expect(res.body.status).toBe('idle');
      expect(res.body.version).toBeNull();
      expect(res.body.error).toBeNull();
    });
  });
});
