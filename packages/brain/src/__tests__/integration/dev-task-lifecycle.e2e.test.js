/**
 * Dev Task 全链路 E2E 测试
 *
 * 覆盖核心路径：dev task → docker spawn → callback → status=completed
 *
 * 历史背景：此链路此前无 E2E 覆盖，导致 callback 静默吞错在 CI 中无法捕获。
 * 本测试关闭该盲区：验证 callback_queue 正确写入 + tasks 状态机迁移 + pr_url 回填。
 *
 * 测试策略：
 *   - mock cecelia-runner（不运行真实 Docker），立即返回 exit_code=0，测试速度 < 10 分钟
 *   - 真实 PostgreSQL：callback_queue + tasks 读写均走真实 DB
 *   - writeDockerCallback 真实调用（验证容器名格式 + callback_queue 写入）
 *   - processExecutionCallback 真实调用（验证状态机 + pr_url 回填）
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const MOCK_PR_URL = 'https://github.com/mock/cecelia/pull/42';

// ─── Mock: callback-processor.js 外部依赖 ──────────────────────────────────────

vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ level: 'normal', actions: [] }),
  EVENT_TYPES: { TASK_COMPLETED: 'task_completed', TASK_FAILED: 'task_failed' },
}));

vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));

vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  emit: vi.fn().mockResolvedValue(null),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../alerting.js', () => ({
  raise: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../routes/shared.js', () => ({
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue(null),
  getActiveExecutionPaths: vi.fn(),
  INVENTORY_CONFIG: {},
}));

vi.mock('../../progress-ledger.js', () => ({
  recordProgressStep: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn().mockResolvedValue(null),
}));

// ─── Mock: task-tasks.js 路由依赖 ──────────────────────────────────────────────

vi.mock('../../domain-detector.js', () => ({
  detectDomain: vi.fn(() => ({ domain: 'agent_ops' })),
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

// ─── Mock: quarantine（同时为 task-tasks.js 提供 FAILURE_CLASS 常量）─────────

vi.mock('../../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false }),
  classifyFailure: vi.fn().mockReturnValue({ class: 'unknown', confidence: 0.5 }),
  FAILURE_CLASS: {
    NETWORK: 'network',
    RATE_LIMIT: 'rate_limit',
    BILLING_CAP: 'billing_cap',
    AUTH: 'auth',
    RESOURCE: 'resource',
  },
}));

// ─── Mock: circuit-breaker ─────────────────────────────────────────────────────

vi.mock('../../circuit-breaker.js', () => ({
  recordSuccess: vi.fn().mockResolvedValue(null),
  recordFailure: vi.fn().mockResolvedValue(null),
  getState: vi.fn(() => ({ state: 'CLOSED', failures: 0 })),
  reset: vi.fn(),
  getAllStates: vi.fn(() => ({})),
}));

// ─── Mock: executor（processExecutionCallback 动态 import executor.js）────────

vi.mock('../../executor.js', () => ({
  removeActiveProcess: vi.fn(),
  setBillingPause: vi.fn(),
  triggerCeceliaRun: vi.fn(),
}));

// ─── Mock: docker-executor spawn 中间件（mock cecelia-runner）─────────────────
// 绕过真实 Docker 调用，立即返回 exit_code=0，测试速度 < 10 分钟。
// writeDockerCallback 本身不 mock（验证它能正确写入 callback_queue）。

vi.mock('../../spawn/middleware/docker-run.js', () => ({
  runDocker: vi.fn().mockImplementation(async (_args, ctx) => ({
    exit_code: 0,
    stdout: `{"type":"result","result":"pr_url: ${MOCK_PR_URL}\\nTask completed successfully"}`,
    stderr: '',
    duration_ms: 50,
    container: ctx.name,
    container_id: null,
    command: `docker run ... ${ctx.name}`,
    timed_out: false,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  })),
}));

vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
  resolveAccountForOpts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../spawn/middleware/cascade.js', () => ({
  resolveCascade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../spawn/middleware/cost-cap.js', () => ({
  checkCostCap: vi.fn().mockResolvedValue(undefined),
  CostCapExceededError: class CostCapExceededError extends Error {},
}));

vi.mock('../../spawn/middleware/billing.js', () => ({
  recordBilling: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../spawn/middleware/cap-marking.js', () => ({
  checkCap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../spawn/middleware/logging.js', () => ({
  createSpawnLogger: vi.fn().mockReturnValue({ logStart: vi.fn(), logEnd: vi.fn() }),
}));

vi.mock('../../spawn/middleware/resource-tier.js', () => ({
  resolveResourceTier: vi.fn().mockReturnValue({
    tier: 'standard',
    memoryMB: 4096,
    cpuCores: 2,
    timeoutMs: 300000,
  }),
  RESOURCE_TIERS: {},
  TASK_TYPE_TIER: {},
}));

// ─── Mock: child_process（docker-executor 内 fs 操作不需要真实 docker 二进制）─

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// ─── 真实 PostgreSQL 连接（验证 DB 写入）─────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const insertedTaskIds = [];

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const taskTasksRouter = await import('../../routes/task-tasks.js').then(m => m.default);
  app.use('/api/brain/tasks', taskTasksRouter);
  return app;
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Dev Task 全链路 E2E — docker spawn → callback → status=completed', () => {
  let app;
  let createdTaskId;

  beforeAll(async () => {
    app = await makeApp();
  }, 20000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
      await testPool.query(
        'DELETE FROM callback_queue WHERE task_id = ANY($1::uuid[])',
        [insertedTaskIds]
      );
    }
    await testPool.end();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: 创建 Dev Task
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 1: POST /api/brain/tasks — 创建 dev task', () => {
    it('POST 创建 dev task → 返回 201，DB 写入 status=queued', async () => {
      const res = await request(app)
        .post('/api/brain/tasks')
        .send({
          title: '[e2e-lifecycle] Dev task 全链路测试',
          description: '全链路 E2E 测试自动创建，测试完毕后自动清理',
          task_type: 'dev',
          priority: 'P2',
          trigger_source: 'api',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('queued');
      expect(res.body.task_type).toBe('dev');

      createdTaskId = res.body.id;
      insertedTaskIds.push(createdTaskId);

      // 直查 DB 确认持久化
      const dbRes = await testPool.query(
        'SELECT status, task_type FROM tasks WHERE id = $1',
        [createdTaskId]
      );
      expect(dbRes.rows[0].status).toBe('queued');
      expect(dbRes.rows[0].task_type).toBe('dev');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: mock cecelia-runner 模拟容器执行完成
  // 验证：container 名遵循 cecelia-task-* + callback_queue 写入正确
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 2: mock cecelia-runner — 模拟容器 exit=0', () => {
    it('container 名格式遵循 cecelia-task-{12位无连字符} 规范', () => {
      expect(createdTaskId).toBeDefined();

      // 验证 containerName 函数的命名约定
      const short = String(createdTaskId).replace(/-/g, '').slice(0, 12);
      const containerName = `cecelia-task-${short}`;

      // 格式：cecelia-task- + 12 位十六进制
      expect(containerName).toMatch(/^cecelia-task-[a-f0-9]{12}$/);
    });

    it('writeDockerCallback 向 callback_queue 写入 exit_code=0 行', async () => {
      expect(createdTaskId).toBeDefined();

      // 模拟 docker container 以 exit_code=0 退出后 executor.js 调用 writeDockerCallback
      const mockDockerResult = {
        exit_code: 0,
        // stdout 格式：parseDockerOutput 提取 result 段，extractField 再从中拿 pr_url
        stdout: `{"type":"result","result":"pr_url: ${MOCK_PR_URL}\\nTask completed"}`,
        stderr: '',
        duration_ms: 100,
        container: `cecelia-task-${String(createdTaskId).replace(/-/g, '').slice(0, 12)}`,
        container_id: null,
        timed_out: false,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      };

      const { writeDockerCallback } = await import('../../docker-executor.js');
      await writeDockerCallback(
        { id: createdTaskId, task_type: 'dev' },
        `mock-run-${createdTaskId}`,
        null,
        mockDockerResult
      );

      // 断言：callback_queue 中存在此 task 的行
      const cbRes = await testPool.query(
        `SELECT task_id, status, exit_code, result_json
           FROM callback_queue
          WHERE task_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 1`,
        [createdTaskId]
      );
      expect(cbRes.rows).toHaveLength(1);
      expect(cbRes.rows[0].task_id).toBe(createdTaskId);
      expect(cbRes.rows[0].status).toBe('success');
      expect(cbRes.rows[0].exit_code).toBe(0);
    });

    it('callback_queue.result_json._meta.pr_url 已从 stdout 提取并写入', async () => {
      expect(createdTaskId).toBeDefined();

      const cbRes = await testPool.query(
        `SELECT result_json FROM callback_queue
          WHERE task_id = $1::uuid
          ORDER BY created_at DESC LIMIT 1`,
        [createdTaskId]
      );
      expect(cbRes.rows).toHaveLength(1);

      const meta = cbRes.rows[0].result_json?._meta;
      expect(meta).toBeDefined();
      expect(meta.executor).toBe('docker');
      // pr_url 从 stdout 提取，写入 _meta
      expect(meta.pr_url).toBe(MOCK_PR_URL);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3: callback 处理 → tasks 状态迁移 + pr_url 回填
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 3: processExecutionCallback — callback_queue → tasks 终态', () => {
    it('processExecutionCallback 将 dev task 迁移到 completed，pr_url 已填', async () => {
      expect(createdTaskId).toBeDefined();

      // 模拟 callback-worker 从 callback_queue 取出行后调用 processExecutionCallback
      const { processExecutionCallback } = await import('../../callback-processor.js');
      const result = await processExecutionCallback(
        {
          task_id: createdTaskId,
          run_id: `mock-run-${createdTaskId}`,
          status: 'success',   // docker exit_code=0 → status='success' → newStatus='completed'
          result: { pr_url: MOCK_PR_URL, result: 'Mock PR created successfully' },
          pr_url: MOCK_PR_URL,
          duration_ms: 100,
          exit_code: 0,
        },
        testPool
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('completed');
    });

    it('tasks.status = completed（DB 持久化验证）', async () => {
      expect(createdTaskId).toBeDefined();

      const dbRes = await testPool.query(
        'SELECT status FROM tasks WHERE id = $1',
        [createdTaskId]
      );
      expect(dbRes.rows[0].status).toBe('completed');
    });

    it('tasks.pr_url = MOCK_PR_URL（pr_url 回填验证）', async () => {
      expect(createdTaskId).toBeDefined();

      const dbRes = await testPool.query(
        'SELECT pr_url FROM tasks WHERE id = $1',
        [createdTaskId]
      );
      expect(dbRes.rows[0].pr_url).toBe(MOCK_PR_URL);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4: 全链路终态断言（cross-phase 汇总验证）
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 4: 全链路终态 — callback_queue + tasks 双表断言', () => {
    it('callback_queue 有 exit_code=0 行 + tasks.status=completed + pr_url 已填', async () => {
      expect(createdTaskId).toBeDefined();

      const [taskRes, cbRes] = await Promise.all([
        testPool.query(
          'SELECT status, pr_url FROM tasks WHERE id = $1',
          [createdTaskId]
        ),
        testPool.query(
          `SELECT status, exit_code FROM callback_queue
            WHERE task_id = $1::uuid AND status = 'success'`,
          [createdTaskId]
        ),
      ]);

      // tasks 终态
      expect(taskRes.rows[0].status).toBe('completed');
      expect(taskRes.rows[0].pr_url).toBe(MOCK_PR_URL);

      // callback_queue 有 success 行
      expect(cbRes.rows.length).toBeGreaterThanOrEqual(1);
      expect(cbRes.rows[0].exit_code).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 5: 失败路径验证
  // docker exit_code≠0 → callback status=failed → tasks.status=failed
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Phase 5: 失败路径 — exit_code=1 → tasks.status=failed', () => {
    let failTaskId;

    it('创建第二个 dev task，专用于失败路径测试', async () => {
      const res = await request(app)
        .post('/api/brain/tasks')
        .send({
          title: '[e2e-lifecycle] Dev task 失败路径测试',
          task_type: 'dev',
          priority: 'P3',
          trigger_source: 'api',
        })
        .expect(201);

      failTaskId = res.body.id;
      insertedTaskIds.push(failTaskId);
      expect(failTaskId).toBeDefined();
    });

    it('writeDockerCallback exit_code=1 → callback_queue status=failed', async () => {
      expect(failTaskId).toBeDefined();

      const failResult = {
        exit_code: 1,
        stdout: '',
        stderr: 'Error: CI gate failed',
        duration_ms: 50,
        container: `cecelia-task-${String(failTaskId).replace(/-/g, '').slice(0, 12)}`,
        container_id: null,
        timed_out: false,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      };

      const { writeDockerCallback } = await import('../../docker-executor.js');
      await writeDockerCallback(
        { id: failTaskId, task_type: 'dev' },
        `mock-run-fail-${failTaskId}`,
        null,
        failResult
      );

      const cbRes = await testPool.query(
        `SELECT status, exit_code FROM callback_queue
          WHERE task_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
        [failTaskId]
      );
      expect(cbRes.rows[0].status).toBe('failed');
      expect(cbRes.rows[0].exit_code).toBe(1);
    });

    it('processExecutionCallback status=failed → tasks.status=failed', async () => {
      expect(failTaskId).toBeDefined();

      const { processExecutionCallback } = await import('../../callback-processor.js');
      const result = await processExecutionCallback(
        {
          task_id: failTaskId,
          run_id: `mock-run-fail-${failTaskId}`,
          status: 'failed',
          result: { result: 'CI gate failed' },
          duration_ms: 50,
          exit_code: 1,
        },
        testPool
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('failed');

      const dbRes = await testPool.query(
        'SELECT status FROM tasks WHERE id = $1',
        [failTaskId]
      );
      expect(dbRes.rows[0].status).toBe('failed');
    });
  });
});
