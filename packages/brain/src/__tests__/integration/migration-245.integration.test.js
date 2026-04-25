/**
 * Migration 245 集成测试（真实 PostgreSQL）
 *
 * 覆盖 migration 245 的落地效果：
 *   1. callback_queue.retry_count 列存在（INTEGER, default 0）
 *   2. idx_callback_queue_retry_count 部分索引存在
 *   3. key_results.progress_pct 列存在（DECIMAL(5,2), default 0.0）
 *   4. health-monitor.js:124 的查询能成功执行
 *   5. kr-verifier.js:126 的查询能成功执行
 *
 * 修两条 silently-degrade 报错：
 *   - [health-monitor] callback_queue_stats query failed: column 'retry_count' does not exist
 *   - [tick] KR health check failed: column g.progress_pct does not exist
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务，已 apply migrations）
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

describe('migration 245 — callback_queue.retry_count + key_results.progress_pct', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('callback_queue.retry_count 列存在（INTEGER, default 0）', async () => {
    const result = await pool.query(`
      SELECT data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'callback_queue'
        AND column_name = 'retry_count'
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('integer');
    expect(result.rows[0].column_default).toBe('0');
  });

  it('idx_callback_queue_retry_count 部分索引存在', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'callback_queue'
        AND indexname = 'idx_callback_queue_retry_count'
    `);
    expect(result.rows).toHaveLength(1);
  });

  it('key_results.progress_pct 列存在（NUMERIC(5,2), default 0.0）', async () => {
    const result = await pool.query(`
      SELECT data_type, numeric_precision, numeric_scale, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'key_results'
        AND column_name = 'progress_pct'
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].numeric_precision).toBe(5);
    expect(result.rows[0].numeric_scale).toBe(2);
    expect(String(result.rows[0].column_default)).toMatch(/^0(\.0+)?$/);
  });

  it('health-monitor.js 查询 callback_queue.retry_count 能成功执行', async () => {
    // 模拟 packages/brain/src/health-monitor.js:124
    const result = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM callback_queue
      WHERE retry_count >= 3
        AND processed_at IS NULL
    `);
    expect(result.rows).toHaveLength(1);
    expect(Number.isFinite(parseInt(result.rows[0].cnt, 10))).toBe(true);
  });

  it('kr-verifier.js 查询 key_results.progress_pct 能成功执行', async () => {
    // 模拟 packages/brain/src/kr-verifier.js:126 的 SELECT 子句
    const result = await pool.query(`
      SELECT id, title, progress_pct
      FROM key_results
      LIMIT 1
    `);
    expect(Array.isArray(result.rows)).toBe(true);
  });
});
