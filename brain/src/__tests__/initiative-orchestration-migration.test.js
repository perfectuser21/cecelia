/**
 * Migration 057 - Initiative 4-Phase 编排基础设施 测试
 *
 * DoD 覆盖: D1
 * 验证 projects 新列和 tasks.task_type CHECK 扩展
 */

import { describe, it, expect, afterAll } from 'vitest';
import pool from '../db.js';

describe('Migration 057 - initiative_orchestration', () => {
  afterAll(async () => {
    // Cleanup test data
    await pool.query("DELETE FROM projects WHERE name LIKE 'mig057_test_%'");
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_%'");
  });

  // D1: projects.execution_mode 列
  it('D1: projects.execution_mode exists with default simple', async () => {
    const result = await pool.query(`
      INSERT INTO projects (name, type, status, description)
      VALUES ('mig057_test_exec_mode', 'initiative', 'active', 'test')
      RETURNING execution_mode
    `);
    expect(result.rows[0].execution_mode).toBe('simple');
  });

  // D1: projects.current_phase 列
  it('D1: projects.current_phase exists with default NULL', async () => {
    const result = await pool.query(`
      INSERT INTO projects (name, type, status, description)
      VALUES ('mig057_test_phase', 'initiative', 'active', 'test')
      RETURNING current_phase
    `);
    expect(result.rows[0].current_phase).toBeNull();
  });

  // D1: projects.current_phase 可以设置值
  it('D1: projects.current_phase accepts phase values', async () => {
    const result = await pool.query(`
      INSERT INTO projects (name, type, status, description, current_phase)
      VALUES ('mig057_test_phase_set', 'initiative', 'active', 'test', 'plan')
      RETURNING current_phase
    `);
    expect(result.rows[0].current_phase).toBe('plan');
  });

  // D1: projects.dod_content 列
  it('D1: projects.dod_content exists as JSONB', async () => {
    const dodContent = [{ item: 'Test DoD', pass_criteria: 'It works' }];
    const result = await pool.query(`
      INSERT INTO projects (name, type, status, description, dod_content)
      VALUES ('mig057_test_dod', 'initiative', 'active', 'test', $1)
      RETURNING dod_content
    `, [JSON.stringify(dodContent)]);
    expect(result.rows[0].dod_content).toEqual(dodContent);
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_plan
  it('D1: tasks.task_type accepts initiative_plan', async () => {
    // Need a goal for non-system task type
    const goalResult = await pool.query(`
      INSERT INTO goals (title, type, priority, status, progress)
      VALUES ('mig057_test_goal', 'kr', 'P1', 'pending', 0)
      RETURNING id
    `);
    const goalId = goalResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_plan_task', 'initiative_plan', 'queued', $1, 'P1')
      RETURNING task_type
    `, [goalId]);
    expect(result.rows[0].task_type).toBe('initiative_plan');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_plan_task'");
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal'");
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_verify
  it('D1: tasks.task_type accepts initiative_verify', async () => {
    const goalResult = await pool.query(`
      INSERT INTO goals (title, type, priority, status, progress)
      VALUES ('mig057_test_goal_v', 'kr', 'P1', 'pending', 0)
      RETURNING id
    `);
    const goalId = goalResult.rows[0].id;

    const result = await pool.query(`
      INSERT INTO tasks (title, task_type, status, goal_id, priority)
      VALUES ('mig057_test_verify_task', 'initiative_verify', 'queued', $1, 'P1')
      RETURNING task_type
    `, [goalId]);
    expect(result.rows[0].task_type).toBe('initiative_verify');

    // Cleanup
    await pool.query("DELETE FROM tasks WHERE title = 'mig057_test_verify_task'");
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal_v'");
  });

  // D1: 索引存在性
  it('D1: idx_projects_execution_mode index exists', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'projects'
        AND indexname = 'idx_projects_execution_mode'
    `);
    expect(result.rows.length).toBe(1);
  });

  it('D1: idx_projects_current_phase index exists', async () => {
    const result = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'projects'
        AND indexname = 'idx_projects_current_phase'
    `);
    expect(result.rows.length).toBe(1);
  });

  // D1: schema_version 057
  it('D1: schema_version 057 exists', async () => {
    const result = await pool.query(`
      SELECT version FROM schema_version WHERE version = '057'
    `);
    expect(result.rows.length).toBe(1);
  });

  // D1: existing task types still work
  it('D1: existing task types still accepted', async () => {
    const goalResult = await pool.query(`
      INSERT INTO goals (title, type, priority, status, progress)
      VALUES ('mig057_test_goal_existing', 'kr', 'P1', 'pending', 0)
      RETURNING id
    `);
    const goalId = goalResult.rows[0].id;

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
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal_existing'");
  });
});
