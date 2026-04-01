/**
 * Executor Callback 集成测试
 *
 * 验证链路：Executor 完成任务 → POST /api/brain/execution-callback → Brain 更新 task 状态 → DB 持久化
 *
 * 测试场景：
 *   1. callback 成功（AI Done）→ task 变 completed → DB 验证 completed_at 有值
 *   2. callback 失败（AI Failed）→ task 变 failed → DB 验证 error_message/blocked_detail 写入
 *   3. callback 携带 result payload → DB 验证 payload.last_run_result 字段写入
 *
 * 运行方式（本地）：
 *   RUN_INTEGRATION=true npx vitest run tests/integration/callback.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';

// ── DB + Brain 配置（与 L4 CI 一致）────────────────────────────────────────
const DB_CONFIG = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'cecelia',
  password: process.env.PGPASSWORD || 'cecelia_ci',
  database: process.env.PGDATABASE || 'cecelia',
};
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

// ── skipIf 机制：无 DB / 无 Brain 时自动跳过 ────────────────────────────
const HAS_DB = Boolean(process.env.DB_PORT || process.env.PGHOST || process.env.RUN_INTEGRATION);

// ── 测试用任务 title 前缀（便于清理）───────────────────────────────────────
const TEST_PREFIX = 'TEST_INTEGRATION_CALLBACK_';

// ── 辅助：在 DB 中直接插入一个 in_progress 任务 ────────────────────────
async function insertInProgressTask(pool: pg.Pool, suffix: string): Promise<string> {
  const title = `${TEST_PREFIX}${suffix}_${Date.now()}`;
  const result = await pool.query(`
    INSERT INTO tasks (
      title, status, task_type, created_at, updated_at
    ) VALUES ($1, 'in_progress', 'dev', NOW(), NOW())
    RETURNING id
  `, [title]);
  return result.rows[0].id as string;
}

// ── 辅助：从 DB 查询任务行 ──────────────────────────────────────────────
async function getTask(pool: pg.Pool, taskId: string) {
  const result = await pool.query(
    `SELECT id, status, completed_at, error_message, blocked_detail, payload
     FROM tasks WHERE id = $1`,
    [taskId]
  );
  return result.rows[0] || null;
}

// ── 辅助：清理测试数据 ───────────────────────────────────────────────────
async function cleanupTestTasks(pool: pg.Pool) {
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${TEST_PREFIX}%`]);
}

// ── 辅助：调用 Brain execution-callback 端点 ────────────────────────────
async function postCallback(body: Record<string, unknown>) {
  const resp = await fetch(`${BRAIN_URL}/api/brain/execution-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json() };
}

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(!HAS_DB)('Callback Integration — Real DB', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool(DB_CONFIG);
    // 确认 DB 连通
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await cleanupTestTasks(pool);
    await pool.end();
  });

  beforeEach(async () => {
    // 每次测试前清理，防止上一轮测试残留影响
    await cleanupTestTasks(pool);
  });

  // ── 场景 1：callback 成功 → completed + completed_at 有值 ──────────────
  it('scenario 1: AI Done callback → task status becomes completed, completed_at set in DB', async () => {
    const taskId = await insertInProgressTask(pool, 'SUCCESS');

    const { status, body } = await postCallback({
      task_id: taskId,
      run_id: `run_inttest_success_${Date.now()}`,
      status: 'AI Done',
      result: { result: 'integration test passed successfully' },
      pr_url: 'https://github.com/test/repo/pull/999',
      duration_ms: 12345,
    });

    // HTTP 层响应正常
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // DB 层验证：任务已 completed，completed_at 不为 null
    const row = await getTask(pool, taskId);
    expect(row).not.toBeNull();
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();

    // payload.last_run_result 应写入
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    expect(payload?.last_run_result).toBeDefined();
    expect(payload.last_run_result.status).toBe('AI Done');
  });

  // ── 场景 2：callback 失败 → failed + error_message/blocked_detail 写入 ─
  it('scenario 2: AI Failed callback → task status becomes failed, error_message persisted in DB', async () => {
    const taskId = await insertInProgressTask(pool, 'FAILURE');

    const { status, body } = await postCallback({
      task_id: taskId,
      run_id: `run_inttest_fail_${Date.now()}`,
      status: 'AI Failed',
      result: { result: 'TypeScript compilation error: cannot find module', error: 'TS2307' },
      exit_code: 1,
      stderr: 'error TS2307: Cannot find module',
      duration_ms: 5000,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // DB 层验证：任务 failed，error_message 有值
    const row = await getTask(pool, taskId);
    expect(row).not.toBeNull();
    expect(row.status).toBe('failed');
    expect(row.error_message).not.toBeNull();
    expect(typeof row.error_message).toBe('string');
    expect(row.error_message.length).toBeGreaterThan(0);

    // blocked_detail 应写入（结构化 JSON）
    expect(row.blocked_detail).not.toBeNull();
    const bd = typeof row.blocked_detail === 'string'
      ? JSON.parse(row.blocked_detail)
      : row.blocked_detail;
    expect(bd).toHaveProperty('exit_code');
    expect(bd).toHaveProperty('timestamp');
  });

  // ── 场景 3：callback 携带 result payload → DB payload 字段验证 ─────────
  it('scenario 3: callback with structured result payload → DB payload.last_run_result contains result data', async () => {
    const taskId = await insertInProgressTask(pool, 'RESULT_PAYLOAD');

    const customResult = {
      result: 'Feature implementation complete',
      findings: 'Added 3 new API endpoints with test coverage',
      usage: {
        input_tokens: 50000,
        output_tokens: 8000,
        cache_read_input_tokens: 10000,
      },
    };

    const { status, body } = await postCallback({
      task_id: taskId,
      run_id: `run_inttest_payload_${Date.now()}`,
      status: 'AI Done',
      result: customResult,
      pr_url: 'https://github.com/test/repo/pull/1234',
      duration_ms: 30000,
      iterations: 5,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // DB 层验证
    const row = await getTask(pool, taskId);
    expect(row).not.toBeNull();
    expect(row.status).toBe('completed');

    // payload.last_run_result 应包含回调数据
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const lastRun = payload?.last_run_result;
    expect(lastRun).toBeDefined();
    expect(lastRun.status).toBe('AI Done');
    expect(lastRun.pr_url).toBe('https://github.com/test/repo/pull/1234');

    // payload.run_status 应为 'AI Done'
    expect(payload.run_status).toBe('AI Done');

    // payload.findings 应写入（来自 result.findings）
    expect(payload.findings).toBe(customResult.findings);
  });
});
