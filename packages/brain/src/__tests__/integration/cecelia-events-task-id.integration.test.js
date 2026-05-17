/**
 * cecelia_events.task_id 列 集成测试（真实 PostgreSQL）
 *
 * 覆盖 migration 235 的落地效果：
 *   1. task_id 列存在且为 UUID 类型
 *   2. 含 task_id 的 INSERT 成功，可用 task_id 反查
 *   3. 部分索引 idx_cecelia_events_task_id 存在
 *
 * 与 packages/brain/src/executor.js 的 onStep 回调配套 —
 * LangGraph pipeline 每步写 langgraph_step 事件依赖本列。
 *
 * 运行环境：CI brain-integration job（含真实 PostgreSQL 服务）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });
const TEST_TASK_ID = '00000000-0000-0000-0000-000000000001';
const TEST_EVENT_TYPE = 'test_cecelia_events_task_id';

describe('cecelia_events.task_id 列 — 集成测试', () => {
  beforeAll(async () => {
    // 确保无残留，避免上次失败未清理污染本轮
    await pool.query(
      `DELETE FROM cecelia_events WHERE task_id = $1 AND event_type = $2`,
      [TEST_TASK_ID, TEST_EVENT_TYPE]
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM cecelia_events WHERE task_id = $1 AND event_type = $2`,
      [TEST_TASK_ID, TEST_EVENT_TYPE]
    );
    await pool.end();
  });

  it('task_id 列存在且为 UUID 类型', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'cecelia_events' AND column_name = 'task_id'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].data_type).toBe('uuid');
  });

  it('部分索引 idx_cecelia_events_task_id 存在', async () => {
    const { rows } = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'cecelia_events' AND indexname = 'idx_cecelia_events_task_id'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef).toMatch(/WHERE.*task_id IS NOT NULL/i);
  });

  it('含 task_id 的 INSERT 成功且可反查', async () => {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, task_id, payload)
       VALUES ($1, $2::uuid, $3::jsonb)`,
      [TEST_EVENT_TYPE, TEST_TASK_ID, JSON.stringify({ test: true, step: 'node1' })]
    );
    const { rows } = await pool.query(
      `SELECT task_id, event_type, payload FROM cecelia_events
       WHERE task_id = $1 AND event_type = $2
       LIMIT 1`,
      [TEST_TASK_ID, TEST_EVENT_TYPE]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].task_id).toBe(TEST_TASK_ID);
    expect(rows[0].payload).toEqual({ test: true, step: 'node1' });
  });

  it('task_id 为 NULL 的 INSERT 也兼容（向后兼容已有 session_end / billing_pause_set 事件）', async () => {
    const { rows } = await pool.query(
      `INSERT INTO cecelia_events (event_type, payload)
       VALUES ($1, $2::jsonb)
       RETURNING id, task_id`,
      ['test_null_task_id_compat', JSON.stringify({ test: true })]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].task_id).toBeNull();
    // cleanup
    await pool.query(`DELETE FROM cecelia_events WHERE id = $1`, [rows[0].id]);
  });
});
