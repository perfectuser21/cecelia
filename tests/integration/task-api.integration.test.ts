/**
 * Task API Integration Test
 *
 * 测试链路：POST /api/brain/tasks → PostgreSQL 写入 → GET 读回 → PATCH 状态流转 → DB 验证
 *
 * 关键原则：
 * - 不 mock 任何内部模块（无模块拦截）
 * - 使用真实 PostgreSQL（pg.Pool 直连）
 * - 使用真实 Brain HTTP API（fetch）
 * - 本地运行需要 Brain 服务在 localhost:5221
 * - CI 运行使用 BRAIN_URL + DB_PORT 环境变量
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { BRAIN_URL, DB_CONFIG, TEST_PREFIX, createTestPool, cleanupTestData } from './setup.js';

// 如果没有真实 DB，跳过（开发者本地快速跑 L3 时不强制）
const HAS_DB = Boolean(process.env.DB_PORT || process.env.PGHOST || process.env.RUN_INTEGRATION);

describe.skipIf(!HAS_DB)('Task API Integration — Real DB', () => {
  let pool: pg.Pool;
  let createdTaskIds: string[] = [];

  beforeAll(async () => {
    pool = await createTestPool();
    await cleanupTestData(pool);
  });

  afterAll(async () => {
    // 清理所有本次测试创建的数据
    if (createdTaskIds.length > 0) {
      await pool.query(
        `DELETE FROM tasks WHERE id = ANY($1::uuid[])`,
        [createdTaskIds]
      );
    }
    await cleanupTestData(pool);
    await pool.end();
  });

  beforeEach(() => {
    createdTaskIds = [];
  });

  it('POST /api/brain/tasks → DB 写入 → 字段完整性验证', async () => {
    const taskTitle = `${TEST_PREFIX}post-verify-${Date.now()}`;

    const res = await fetch(`${BRAIN_URL}/api/brain/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: taskTitle,
        task_type: 'dev',
        priority: 'medium',
        domain: 'quality',
      }),
    });

    expect(res.status, `POST /tasks 应返回 201，实际: ${res.status}`).toBe(201);
    const task = await res.json();
    expect(task.id).toBeTruthy();
    createdTaskIds.push(task.id);

    // 直接查 DB 验证写入正确性
    const dbResult = await pool.query(
      'SELECT id, title, status, task_type, priority, domain FROM tasks WHERE id = $1',
      [task.id]
    );
    expect(dbResult.rows).toHaveLength(1);
    const row = dbResult.rows[0];
    expect(row.title).toBe(taskTitle);
    expect(row.status).toBe('queued');
    expect(row.task_type).toBe('dev');
    expect(row.priority).toBe('medium');
    expect(row.domain).toBe('quality');
  });

  it('GET /api/brain/tasks/:id → 返回数据与 DB 一致', async () => {
    // 先直接写 DB 创建一条记录（绕过 API，验证读路径）
    const taskTitle = `${TEST_PREFIX}get-verify-${Date.now()}`;
    const insertResult = await pool.query(
      `INSERT INTO tasks (title, task_type, status, priority)
       VALUES ($1, 'dev', 'queued', 'low')
       RETURNING id`,
      [taskTitle]
    );
    const taskId = insertResult.rows[0].id;
    createdTaskIds.push(taskId);

    // 通过 API 读取
    const res = await fetch(`${BRAIN_URL}/api/brain/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const task = await res.json();
    expect(task.id).toBe(taskId);
    expect(task.title).toBe(taskTitle);
    expect(task.status).toBe('queued');
  });

  it('PATCH /api/brain/tasks/:id → 状态流转 → DB 确认', async () => {
    const taskTitle = `${TEST_PREFIX}patch-status-${Date.now()}`;

    // 创建任务
    const createRes = await fetch(`${BRAIN_URL}/api/brain/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskTitle, task_type: 'dev' }),
    });
    const task = await createRes.json();
    createdTaskIds.push(task.id);
    expect(task.status).toBe('queued');

    // 状态流转：queued → in_progress
    const patchRes = await fetch(`${BRAIN_URL}/api/brain/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(patchRes.status).toBe(200);

    // DB 直接验证
    const dbResult = await pool.query('SELECT status, started_at FROM tasks WHERE id = $1', [task.id]);
    expect(dbResult.rows[0].status).toBe('in_progress');
    // started_at 应该被自动设置
    expect(dbResult.rows[0].started_at).not.toBeNull();

    // 状态流转：in_progress → completed
    await fetch(`${BRAIN_URL}/api/brain/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', result: { pr_url: 'https://github.com/test/pr/1' } }),
    });
    const dbResult2 = await pool.query('SELECT status, completed_at FROM tasks WHERE id = $1', [task.id]);
    expect(dbResult2.rows[0].status).toBe('completed');
    expect(dbResult2.rows[0].completed_at).not.toBeNull();
  });

  it('GET /api/brain/tasks?status=queued → 只返回 queued 任务', async () => {
    const taskTitle = `${TEST_PREFIX}filter-test-${Date.now()}`;

    // 创建一个 queued 任务
    const createRes = await fetch(`${BRAIN_URL}/api/brain/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: taskTitle, task_type: 'dev' }),
    });
    const task = await createRes.json();
    createdTaskIds.push(task.id);

    // 查询 queued 任务列表
    const listRes = await fetch(`${BRAIN_URL}/api/brain/tasks?status=queued&limit=100`);
    expect(listRes.status).toBe(200);
    const tasks = await listRes.json();

    // 确认我们创建的任务在列表里
    const found = tasks.find((t: any) => t.id === task.id);
    expect(found).toBeTruthy();

    // 确认列表里没有非 queued 状态的任务
    const nonQueued = tasks.filter((t: any) => t.status !== 'queued');
    expect(nonQueued).toHaveLength(0);
  });
});
