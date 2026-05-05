/**
 * progress-ledger UNIQUE 约束集成测试
 *
 * 验证：
 *   1. migration 263 后 uk_progress_ledger_step 约束存在
 *   2. 相同 (task_id, run_id, step_sequence) 插入两次 → DO UPDATE（不报错）
 *
 * 运行环境：需真实 PostgreSQL（cecelia_test），在 brain-integration CI job 跑。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool(DB_DEFAULTS);

const TEST_TASK_ID = '00000000-0000-0000-0000-000000000263';

beforeAll(async () => {
  // 确保 FK 需要的 tasks 记录存在
  await pool.query(`
    INSERT INTO tasks (id, title, status)
    VALUES ($1, 'test-progress-ledger-constraint', 'queued')
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TASK_ID]);
});

afterAll(async () => {
  await pool.query('DELETE FROM progress_ledger WHERE task_id = $1', [TEST_TASK_ID]);
  await pool.query('DELETE FROM tasks WHERE id = $1', [TEST_TASK_ID]);
  await pool.end();
});

describe('progress_ledger UNIQUE 约束', () => {
  it('uk_progress_ledger_step 约束存在于 pg_catalog', async () => {
    const res = await pool.query(`
      SELECT COUNT(*)::int AS cnt
      FROM pg_constraint
      WHERE conname = 'uk_progress_ledger_step'
    `);
    expect(res.rows[0].cnt).toBe(1);
  });

  it('相同 (task_id, run_id, step_sequence) 插入两次 → ON CONFLICT DO UPDATE 不报错', async () => {
    const runId  = '00000000-0000-0000-0000-000000000001';

    // 清理：确保干净状态
    await pool.query('DELETE FROM progress_ledger WHERE task_id = $1', [TEST_TASK_ID]);

    const upsert = () => pool.query(`
      INSERT INTO progress_ledger (
        task_id, run_id, step_sequence, step_name, step_type, status
      )
      VALUES ($1, $2, 1, 'test_step', 'execution', 'completed')
      ON CONFLICT (task_id, run_id, step_sequence)
      DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
      RETURNING id
    `, [TEST_TASK_ID, runId]);

    // 第一次插入
    const r1 = await upsert();
    expect(r1.rows).toHaveLength(1);

    // 第二次插入相同 key → 应触发 DO UPDATE，不报错
    const r2 = await upsert();
    expect(r2.rows).toHaveLength(1);
    expect(r2.rows[0].id).toBe(r1.rows[0].id); // 同一行被更新
  });
});
