/**
 * Migration 057 - Initiative 4-Phase 编排基础设施 测试
 *
 * DoD 覆盖: D1
 * 验证 projects 新列和 tasks.task_type CHECK 扩展
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
});

describe('Migration 057 - initiative_orchestration', () => {
  afterAll(async () => {
    // Cleanup test data (projects table dropped in migration 185)
    await pool.query("DELETE FROM projects WHERE name LIKE 'mig057_test_%'").catch(() => {});
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_%'");
  });

  // D1: projects.execution_mode 列（projects 表已由 migration 185 DROP，跳过）
  it.skip('D1: projects.execution_mode exists with default simple', async () => {});

  // D1: projects.current_phase 列（projects 表已由 migration 185 DROP，跳过）
  it.skip('D1: projects.current_phase exists with default NULL', async () => {});

  // D1: projects.current_phase 可以设置值（projects 表已由 migration 185 DROP，跳过）
  it.skip('D1: projects.current_phase accepts phase values', async () => {});

  // D1: projects.dod_content 列（projects 表已由 migration 185 DROP，跳过）
  it.skip('D1: projects.dod_content exists as JSONB', async () => {});

  // D1: tasks.task_type CHECK 扩展 - initiative_plan
  it('D1: tasks.task_type accepts initiative_plan', async () => {
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status)
      VALUES ('mig057_test_goal', 'P1', 'pending')
      RETURNING id
    `);
    const goalId = krResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_plan_task', 'initiative_plan', 'queued', $1, 'P1')
      RETURNING task_type
    `, [goalId]);
    expect(result.rows[0].task_type).toBe('initiative_plan');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_plan_task'");
    await pool.query("DELETE FROM key_results WHERE id = $1", [goalId]);
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_verify
  it('D1: tasks.task_type accepts initiative_verify', async () => {
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status)
      VALUES ('mig057_test_goal_v', 'P1', 'pending')
      RETURNING id
    `);
    const goalId = krResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_verify_task', 'initiative_verify', 'queued', $1, 'P1')
      RETURNING task_type
    `, [goalId]);
    expect(result.rows[0].task_type).toBe('initiative_verify');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_verify_task'");
    await pool.query("DELETE FROM key_results WHERE id = $1", [goalId]);
  });

  // D1: 索引存在性（projects 表已由 migration 185 DROP，索引随之删除，跳过）
  it.skip('D1: idx_projects_execution_mode index exists', async () => {});

  it.skip('D1: idx_projects_current_phase index exists', async () => {});

  // D1: schema_version 057
  it('D1: schema_version 057 exists', async () => {
    const result = await pool.query(`
      SELECT version FROM schema_version WHERE version = '057'
    `);
    expect(result.rows.length).toBe(1);
  });

  // D1: existing task types still work
  it('D1: existing task types still accepted', async () => {
    const krResult = await pool.query(`
      INSERT INTO key_results (title, priority, status)
      VALUES ('mig057_test_goal_existing', 'P1', 'pending')
      RETURNING id
    `);
    const goalId = krResult.rows[0].id;

    const existingTypes = ['dev', 'review', 'talk', 'data', 'research', 'exploratory', 'qa', 'audit', 'decomp_review', 'codex_qa'];
    for (const taskType of existingTypes) {
      const result = await pool.query(`
        INSERT INTO tasks (title, task_type, status, goal_id, priority)
        VALUES ($1, $2, 'queued', $3, 'P1')
        RETURNING task_type
      `, [`mig057_test_existing_${taskType}`, taskType, goalId]);
      expect(result.rows[0].task_type).toBe(taskType);
    }

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_existing_%'");
    await pool.query("DELETE FROM key_results WHERE id = $1", [goalId]);
  });
});
