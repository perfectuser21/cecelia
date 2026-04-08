/**
 * Harness Flow 集成测试
 *
 * 覆盖 harness 任务链路的状态流转和过滤能力：
 *
 * 1. POST /api/brain/tasks — 创建 harness_generate 类型任务，DB 持久化
 * 2. GET /api/brain/tasks?task_type=harness_generate — 按 task_type 过滤
 * 3. harness payload 字段（sprint_dir / eval_round / pr_url）存储与读取
 * 4. PATCH 状态流转：queued → in_progress → completed
 * 5. GET /api/brain/tasks?task_type=harness_evaluate — 其他 harness 类型也可过滤
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

// ─── 真实 DB 连接池（用于直接验证写入）─────────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const insertedTaskIds = [];

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());
  const taskRouter = await import('../../routes/task-tasks.js').then(m => m.default);
  app.use('/api/brain/tasks', taskRouter);
  return app;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('Harness Flow — harness_generate 任务状态流转与过滤（真实 PostgreSQL）', () => {
  let app;
  let harnessGenerateTaskId;
  let harnessEvaluateTaskId;

  beforeAll(async () => {
    app = await makeApp();
  }, 20000);

  afterAll(async () => {
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  // ── 场景 1: 创建 harness_generate 任务 ────────────────────────────────────────

  it('场景1: POST /api/brain/tasks — 创建 harness_generate 任务，status=queued，DB 持久化', async () => {
    const payload = {
      sprint_dir: '/path/to/sprint-1',
      eval_round: 1,
      contract_file: 'sprint-contract.md',
    };

    const res = await request(app)
      .post('/api/brain/tasks')
      .send({
        title: '[harness-flow-test] harness_generate 测试任务',
        description: 'Harness Flow 集成测试自动创建，测试完毕后自动清理',
        task_type: 'harness_generate',
        priority: 'P1',
        trigger_source: 'api',
        payload,
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('queued');
    expect(res.body.task_type).toBe('harness_generate');

    harnessGenerateTaskId = res.body.id;
    insertedTaskIds.push(harnessGenerateTaskId);

    // DB 直查验证 payload 持久化
    const dbRes = await testPool.query(
      'SELECT task_type, status, payload FROM tasks WHERE id = $1',
      [harnessGenerateTaskId]
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].task_type).toBe('harness_generate');
    expect(dbRes.rows[0].status).toBe('queued');
    expect(dbRes.rows[0].payload?.sprint_dir).toBe('/path/to/sprint-1');
    expect(dbRes.rows[0].payload?.eval_round).toBe(1);
  });

  // ── 场景 2: 创建 harness_evaluate 任务 ───────────────────────────────────

  it('场景2: POST /api/brain/tasks — 创建 harness_evaluate 任务（含 pr_url payload）', async () => {
    const payload = {
      sprint_dir: '/path/to/sprint-1',
      eval_round: 1,
      pr_url: 'https://github.com/test/repo/pull/100',
    };

    const res = await request(app)
      .post('/api/brain/tasks')
      .send({
        title: '[harness-flow-test] harness_evaluate 测试任务',
        description: 'Harness Flow 集成测试自动创建，测试完毕后自动清理',
        task_type: 'harness_evaluate',
        priority: 'P1',
        trigger_source: 'api',
        payload,
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('queued');
    expect(res.body.task_type).toBe('harness_evaluate');

    harnessEvaluateTaskId = res.body.id;
    insertedTaskIds.push(harnessEvaluateTaskId);

    // DB 直查 pr_url 存储
    const dbRes = await testPool.query(
      'SELECT payload FROM tasks WHERE id = $1',
      [harnessEvaluateTaskId]
    );
    expect(dbRes.rows[0].payload?.pr_url).toBe('https://github.com/test/repo/pull/100');
  });

  // ── 场景 3: task_type 过滤 ────────────────────────────────────────────────

  it('场景3: GET /api/brain/tasks?task_type=harness_generate — 过滤出 harness_generate 任务', async () => {
    expect(harnessGenerateTaskId).toBeDefined();

    const res = await request(app)
      .get('/api/brain/tasks?task_type=harness_generate&limit=50')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map(t => t.id);
    expect(ids).toContain(harnessGenerateTaskId);

    // 验证过滤结果中不包含 harness_evaluate 任务
    const taskTypes = res.body.map(t => t.task_type);
    expect(taskTypes.every(tt => tt === 'harness_generate')).toBe(true);
  });

  it('场景4: GET /api/brain/tasks?task_type=harness_evaluate — 过滤出 harness_evaluate 任务', async () => {
    expect(harnessEvaluateTaskId).toBeDefined();

    const res = await request(app)
      .get('/api/brain/tasks?task_type=harness_evaluate&limit=50')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map(t => t.id);
    expect(ids).toContain(harnessEvaluateTaskId);

    // 验证过滤结果中不包含 harness_generate 任务
    const taskTypes = res.body.map(t => t.task_type);
    expect(taskTypes.every(tt => tt === 'harness_evaluate')).toBe(true);
  });

  // ── 场景 5: 状态流转 ──────────────────────────────────────────────────────

  it('场景5: PATCH in_progress — harness_generate 任务可以被拾取，状态更新到 DB', async () => {
    expect(harnessGenerateTaskId).toBeDefined();

    const res = await request(app)
      .patch(`/api/brain/tasks/${harnessGenerateTaskId}`)
      .send({ status: 'in_progress' })
      .expect(200);

    expect(res.body.status).toBe('in_progress');

    const dbRes = await testPool.query('SELECT status FROM tasks WHERE id = $1', [harnessGenerateTaskId]);
    expect(dbRes.rows[0].status).toBe('in_progress');
  });

  it('场景6: PATCH completed + verdict payload — harness_generate 完成，结果可读取', async () => {
    expect(harnessGenerateTaskId).toBeDefined();

    const res = await request(app)
      .patch(`/api/brain/tasks/${harnessGenerateTaskId}`)
      .send({
        status: 'completed',
        result: {
          verdict: 'PASS',
          eval_round: 1,
          pr_url: 'https://github.com/test/repo/pull/101',
        },
      })
      .expect(200);

    expect(res.body.status).toBe('completed');

    // DB 直查确认状态
    const dbRes = await testPool.query('SELECT status FROM tasks WHERE id = $1', [harnessGenerateTaskId]);
    expect(dbRes.rows[0].status).toBe('completed');
  });

  // ── 场景 7: GET 单个任务，可通过 ID 查询 harness 任务 ────────────────────

  it('场景7: GET /api/brain/tasks/:id — 可按 ID 查询 harness_evaluate 任务', async () => {
    expect(harnessEvaluateTaskId).toBeDefined();

    const res = await request(app)
      .get(`/api/brain/tasks/${harnessEvaluateTaskId}`)
      .expect(200);

    expect(res.body.id).toBe(harnessEvaluateTaskId);
    expect(res.body.task_type).toBe('harness_evaluate');
    expect(res.body.status).toBe('queued');
  });
});
