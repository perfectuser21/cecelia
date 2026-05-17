/**
 * Migration 057 - Initiative 4-Phase 编排基础设施 测试
 *
 * DoD 覆盖: D1
 * 验证 tasks.task_type CHECK 扩展（projects 表已在 migration 185 中 DROP）
 *
 * 注意：migration 057 在旧 projects 表上添加的列（execution_mode/current_phase/dod_content）
 * 随着 migration 185 DROP TABLE projects CASCADE 已不存在。
 * 本测试仅验证 tasks 表相关的功能，以及 projects 表已 DROP 的事实。
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
});

describe('Migration 057 - initiative_orchestration', () => {
  afterAll(async () => {
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_%'");
    await pool.query("DELETE FROM key_results WHERE title LIKE 'mig057_test_%'");
  });

  // migration 185 验证：projects 表已 DROP
  it('D1: projects 表已在 migration 185 中 DROP', async () => {
    await expect(
      pool.query("SELECT 1 FROM projects LIMIT 1")
    ).rejects.toThrow();
  });

  // migration 185 验证：projects 表索引已不存在
  it('D1: idx_projects_execution_mode 索引已随 projects 表一并删除', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'projects'
        AND indexname = 'idx_projects_execution_mode'
    `);
    expect(result.rows.length).toBe(0);
  });

  it('D1: idx_projects_current_phase 索引已随 projects 表一并删除', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'projects'
        AND indexname = 'idx_projects_current_phase'
    `);
    expect(result.rows.length).toBe(0);
  });

  // D1: schema_version 057
  it('D1: schema_version 057 exists', async () => {
    const result = await pool.query(`
      SELECT version FROM schema_version WHERE version = '057'
    `);
    expect(result.rows.length).toBe(1);
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_plan
  it('D1: tasks.task_type accepts initiative_plan', async () => {
    // Need a KR for non-system task type
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status, progress)
      VALUES ('mig057_test_goal', 'P1', 'pending', 0)
      RETURNING id
    `);
    const krId = krResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_plan_task', 'initiative_plan', 'queued', $1, 'P1')
      RETURNING task_type
    `, [krId]);
    expect(result.rows[0].task_type).toBe('initiative_plan');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_plan_task'");
    await pool.query("DELETE FROM key_results WHERE title = 'mig057_test_goal'");
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_verify
  it('D1: tasks.task_type accepts initiative_verify', async () => {
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status, progress)
      VALUES ('mig057_test_goal_v', 'P1', 'pending', 0)
      RETURNING id
    `);
    const krId = krResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_verify_task', 'initiative_verify', 'queued', $1, 'P1')
      RETURNING task_type
    `, [krId]);
    expect(result.rows[0].task_type).toBe('initiative_verify');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_verify_task'");
    await pool.query("DELETE FROM key_results WHERE title = 'mig057_test_goal_v'");
  });

  // D1: existing task types still work
  it('D1: existing task types still accepted', async () => {
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status, progress)
      VALUES ('mig057_test_goal_existing', 'P1', 'pending', 0)
      RETURNING id
    `);
    const krId = krResult.rows[0].id;

    const existingTypes = ['dev', 'review', 'talk', 'data', 'research', 'exploratory', 'qa', 'audit', 'decomp_review', 'codex_qa'];
    for (const taskType of existingTypes) {
      const result = await pool.query(`
        INSERT INTO tasks (title, task_type, status, goal_id, priority)
        VALUES ($1, $2, 'queued', $3, 'P1')
        RETURNING task_type
      `, [`mig057_test_existing_${taskType}`, taskType, krId]);
      expect(result.rows[0].task_type).toBe(taskType);
    }

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_existing_%'");
    await pool.query("DELETE FROM key_results WHERE title = 'mig057_test_goal_existing'");
  });
});
