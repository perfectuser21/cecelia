/**
 * Task 状态流转 Integration Test
 *
 * 验证 queued → in_progress → completed 状态流转是否真实持久化到 PostgreSQL。
 *
 * 覆盖的 6 个步骤：
 *   1. POST /api/brain/tasks — 创建测试任务，验证 status=queued
 *   2. GET  /api/brain/tasks?status=queued — 验证能在列表中查到
 *   3. PATCH /api/brain/tasks/:id (queued → in_progress) — 验证 200 + DB 持久化
 *   4. GET  /api/brain/tasks/:id — 独立查询验证 in_progress 持久化
 *   5. PATCH /api/brain/tasks/:id (in_progress → completed) — 验证 200 + DB 持久化 + completed_at
 *   6. afterAll teardown — 直接 DB 删除清理
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务）
 * 不 mock db.js，使用真实 PostgreSQL 连接验证端到端持久化行为。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock 外部依赖（只测路由 + DB 链路，不测 AI/事件发布）──────────────────

vi.mock('../../event-bus.js', () => ({
  ensureEventsTable: vi.fn(),
  queryEvents: vi.fn().mockResolvedValue([]),
  getEventCounts: vi.fn().mockResolvedValue({}),
  emit: vi.fn().mockResolvedValue(undefined),
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

// ─── 真实 DB 连接池（用于直接验证 DB 持久化 + teardown）───────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录测试插入的任务 ID，afterAll 统一清理
const insertedTaskIds = [];

// ─── Express App 工厂 ────────────────────────────────────────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());

  const taskTasksRouter = await import('../../routes/task-tasks.js').then(m => m.default);

  // 挂载路径与 server.js 一致
  app.use('/api/brain/tasks', taskTasksRouter);

  return app;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('Task 状态流转 Integration Test（queued → in_progress → completed）', () => {
  let app;
  let taskId;

  const TEST_TITLE_PREFIX = '[TEST-status-transitions]';
  const TEST_TITLE = `${TEST_TITLE_PREFIX} Brain 状态流转集成测试 ${Date.now()}`;

  beforeAll(async () => {
    app = await makeApp();
  }, 15000);

  afterAll(async () => {
    // 直接 DB 删除清理（completed 是 terminal status，无法通过 PATCH 清理）
    if (insertedTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [insertedTaskIds]);
    }
    await testPool.end();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: 创建任务 — 验证初始 status=queued
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 1: POST /api/brain/tasks — 创建任务，status 初始为 queued', async () => {
    const res = await request(app)
      .post('/api/brain/tasks')
      .send({
        title: TEST_TITLE,
        description: 'Brain 状态流转集成测试，测试完毕后自动清理',
        task_type: 'dev',
        priority: 'P2',
        trigger_source: 'test',
      })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(typeof res.body.id).toBe('string');
    expect(res.body.title).toContain(TEST_TITLE_PREFIX);
    expect(res.body.status).toBe('queued');

    taskId = res.body.id;
    insertedTaskIds.push(taskId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: 查询列表 — 验证 status=queued 过滤能找到刚创建的任务
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 2: GET /api/brain/tasks?status=queued — 列表包含刚创建的任务', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .get('/api/brain/tasks?status=queued&limit=200')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map(t => t.id);
    expect(ids).toContain(taskId);

    // 确认列表中所有任务 status 均为 queued（过滤生效）
    for (const task of res.body) {
      expect(task.status).toBe('queued');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: queued → in_progress — 验证 HTTP 200 + DB 持久化
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 3: PATCH queued → in_progress — 返回 200，DB 中 status 已更新', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .patch(`/api/brain/tasks/${taskId}`)
      .send({ status: 'in_progress' })
      .expect(200);

    // HTTP 响应验证
    expect(res.body).toHaveProperty('id', taskId);
    expect(res.body.status).toBe('in_progress');

    // DB 持久化验证（直接查询，绕过路由层）
    const dbRes = await testPool.query(
      'SELECT status, started_at FROM tasks WHERE id = $1',
      [taskId]
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].status).toBe('in_progress');
    // started_at 应自动设置
    expect(dbRes.rows[0].started_at).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: 独立 GET 验证 in_progress 持久化
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 4: GET /api/brain/tasks/:id — 独立查询验证 status=in_progress 已持久化', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .get(`/api/brain/tasks/${taskId}`)
      .expect(200);

    expect(res.body.id).toBe(taskId);
    expect(res.body.status).toBe('in_progress');
    expect(res.body.title).toContain(TEST_TITLE_PREFIX);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: in_progress → completed — 验证 HTTP 200 + DB 持久化 + completed_at
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 5: PATCH in_progress → completed — 返回 200，DB 中 status=completed + completed_at 已设置', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .patch(`/api/brain/tasks/${taskId}`)
      .send({ status: 'completed' })
      .expect(200);

    // HTTP 响应验证
    expect(res.body).toHaveProperty('id', taskId);
    expect(res.body.status).toBe('completed');

    // DB 持久化验证
    const dbRes = await testPool.query(
      'SELECT status, completed_at, updated_at FROM tasks WHERE id = $1',
      [taskId]
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].status).toBe('completed');
    // completed_at 应自动设置
    expect(dbRes.rows[0].completed_at).not.toBeNull();
    // updated_at 应更新
    expect(dbRes.rows[0].updated_at).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: 验证 completed 任务可通过 status=completed 过滤查到
  // ─────────────────────────────────────────────────────────────────────────

  it('Step 6: GET /api/brain/tasks?status=completed — 能查到 completed 的任务', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .get('/api/brain/tasks?status=completed&limit=200')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map(t => t.id);
    expect(ids).toContain(taskId);

    // 确认所有返回任务 status 均为 completed
    for (const task of res.body) {
      expect(task.status).toBe('completed');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 边界验证：terminal status 无法回退
  // ─────────────────────────────────────────────────────────────────────────

  it('边界验证: completed 任务尝试回退到 in_progress 应返回 409', async () => {
    expect(taskId).toBeDefined();

    const res = await request(app)
      .patch(`/api/brain/tasks/${taskId}`)
      .send({ status: 'in_progress' })
      .expect(409);

    expect(res.body).toHaveProperty('error');
  });
});
