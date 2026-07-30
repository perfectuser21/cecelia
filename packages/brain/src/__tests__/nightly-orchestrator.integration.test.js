/**
 * nightly-orchestrator.integration.test.js
 *
 * markDispatched NULL payload 回归集成测试
 *
 * Task ID: 2faafa72-9358-4057-b1e6-6f5a67133ed7
 * Sprint: 07220725-fix-markdispatched-null-payload
 *
 * 覆盖范围：
 *   BEHAVIOR-1: NULL payload 任务经 markDispatched 后，dispatched_by_orchestrator 字段写入成功
 *   BEHAVIOR-2: markDispatched 后任务不再出现于 getPendingBacklog（防重派）
 *   BEHAVIOR-3: 向后兼容 — 已有 payload 的任务内容不丢失
 *
 * TDD 顺序：
 *   Commit A（此文件）: 测试此时 FAIL（证明 bug 存在）
 *   Commit B（修复）:   COALESCE 防御修复，测试变 GREEN
 *
 * 禁止：vi.mock('pg') / jest.mock('pg')
 * 要求：连接真实 PostgreSQL（TEST_DATABASE_URL 或 DB_NAME=cecelia_test）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { markDispatched } from '../nightly-orchestrator.js';

// ─── 真实 DB 连接池（不 mock pg）────────────────────────────────────────────

const testPool = new pg.Pool({
  ...DB_DEFAULTS,
  max: 3,
});

// 记录本次测试创建的任务 ID，afterAll 统一清理
const createdTaskIds = [];

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/**
 * 插入一条测试任务并追踪 ID，afterAll 清理
 */
async function insertTestTask({ payload = null, priority = 'P2' } = {}) {
  const title = `[TEST-markDispatched-null-payload] ${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await testPool.query(
    `INSERT INTO tasks (title, task_type, status, priority, payload, created_at, updated_at)
     VALUES ($1, 'dev', 'queued', $2, $3, NOW() - INTERVAL '1 hour', NOW())
     RETURNING id`,
    [title, priority, payload ? JSON.stringify(payload) : null]
  );
  const id = result.rows[0].id;
  createdTaskIds.push(id);
  return id;
}

/**
 * 直接查询 payload 字段（用于 DB 断言）
 */
async function queryPayload(taskId) {
  const { rows } = await testPool.query(
    `SELECT payload, status FROM tasks WHERE id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

/**
 * 直接执行 getPendingBacklog 等效 SQL（不调用模块内私有函数，直接用 SQL）
 */
async function queryPendingBacklog() {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await testPool.query(
    `SELECT t.id
     FROM tasks t
     WHERE t.status = 'queued'
       AND (
         t.payload->>'dispatched_by_orchestrator' IS NULL
         OR t.payload->>'dispatched_orchestrator_date' < $1
       )
       AND t.task_type NOT IN (
         'harness_planner', 'harness_contract_propose', 'harness_contract_review',
         'harness_generate', 'harness_evaluate', 'harness_fix', 'harness_report',
         'sprint_planner', 'sprint_generate', 'sprint_evaluate'
       )`,
    [today]
  );
  return rows.map(r => r.id);
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

const HAS_REAL_POSTGRES = Boolean(process.env.DATABASE_URL || process.env.DB);

describe.runIf(HAS_REAL_POSTGRES)('markDispatched NULL payload 防重派幂等击穿修复 — 集成测试', () => {
  beforeAll(async () => {
    // 验证测试 DB 连接正常
    await testPool.query('SELECT 1');
  }, 15000);

  afterAll(async () => {
    // 清理本次测试插入的所有任务
    if (createdTaskIds.length > 0) {
      await testPool.query('DELETE FROM tasks WHERE id = ANY($1)', [createdTaskIds]);
    }
    await testPool.end();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BEHAVIOR-1: NULL payload 写入断言
  // ──────────────────────────────────────────────────────────────────────────

  it('[BEHAVIOR-1] NULL payload 任务经 markDispatched 后，dispatched_by_orchestrator 字段应为 true', async () => {
    const taskId = await insertTestTask({ payload: null });

    // 调用 markDispatched（被测函数）
    await markDispatched(taskId);

    // DB 断言
    const row = await queryPayload(taskId);
    expect(row).not.toBeNull();

    const dispatchedFlag = row.payload?.['dispatched_by_orchestrator'];
    expect(dispatchedFlag, '期望 dispatched_by_orchestrator = true，当前为 null（NULL||jsonb=NULL bug）').toBe(true);

    const dispatchedDate = row.payload?.['dispatched_orchestrator_date'];
    const today = new Date().toISOString().split('T')[0];
    expect(dispatchedDate, '期望 dispatched_orchestrator_date 为今日日期').toBe(today);

    // INV-2: status 不得被 markDispatched 改变
    expect(row.status, '期望 status 保持 queued').toBe('queued');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BEHAVIOR-2: 防重派 — markDispatched 后不再出现于 getPendingBacklog
  // ──────────────────────────────────────────────────────────────────────────

  it('[BEHAVIOR-2] NULL payload 任务 markDispatched 后，不应再出现于 getPendingBacklog', async () => {
    const taskId = await insertTestTask({ payload: null, priority: 'P1' });

    // 第一轮：任务应该在 backlog 中
    const backlogBefore = await queryPendingBacklog();
    expect(backlogBefore, '第一轮 backlog 应包含目标任务').toContain(taskId);

    // 执行 markDispatched
    await markDispatched(taskId);

    // 第二轮：任务不应再出现
    const backlogAfter = await queryPendingBacklog();
    expect(backlogAfter, 'markDispatched 后 backlog 不应再包含该任务（防重派失效）').not.toContain(taskId);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BEHAVIOR-3: 向后兼容 — 已有 payload 的任务内容不丢失
  // ──────────────────────────────────────────────────────────────────────────

  it('[BEHAVIOR-3] 已有 payload 的任务，markDispatched 后原有字段保留，新字段正确写入', async () => {
    const existingPayload = { existing_key: 'existing_value', other_field: 42 };
    const taskId = await insertTestTask({ payload: existingPayload });

    // 调用 markDispatched
    await markDispatched(taskId);

    // DB 断言
    const row = await queryPayload(taskId);
    expect(row).not.toBeNull();

    // 原有字段保留（向后兼容）
    expect(row.payload?.['existing_key'], '原有 existing_key 字段应保留').toBe('existing_value');
    expect(row.payload?.['other_field'], '原有 other_field 字段应保留').toBe(42);

    // 新字段正确写入
    expect(row.payload?.['dispatched_by_orchestrator'], '新增 dispatched_by_orchestrator 应为 true').toBe(true);

    const today = new Date().toISOString().split('T')[0];
    expect(row.payload?.['dispatched_orchestrator_date'], '新增 dispatched_orchestrator_date 应为今日').toBe(today);
  });
});
