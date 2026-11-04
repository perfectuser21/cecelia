/** 历史迁移 057 的真实 PG 合同：在该迁移版本的前置 schema 上执行正式 SQL。
 * 当前 projects 已由 497 重建；185 只删除外键，186 才删除旧表。
 * 此处保障历史升级路径，不声称是当前全量 schema 的快照。
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { openFixture, closeFixture } from './helpers/debt-11-pg.js';
vi.mock('../db.js', async () => ({ default: (await import('./helpers/debt-11-pg.js')).pool }));
let pool;

beforeAll(async () => {
  await openFixture('migration057', ['000_base_schema.sql']);
  const { pool: fixture, migrate } = await import('./helpers/debt-11-pg.js');
  await fixture.query('ALTER TABLE tasks ADD COLUMN task_type text');
  await migrate('057_initiative_orchestration.sql');
  pool = (await import('../db.js')).default;
});

describe('Migration 057 - initiative_orchestration', () => {
  afterAll(async () => {
    await pool.query("DELETE FROM tasks WHERE title LIKE 'mig057_test_%'");
    await pool.query("DELETE FROM goals WHERE title LIKE 'mig057_test_%'");
  });

  it('D1: 057 新增项目编排列及默认值', async () => {
    const { rows: [row] } = await pool.query("INSERT INTO projects(name) VALUES ('fixture') RETURNING execution_mode, current_phase, dod_content");
    expect(row).toEqual({ execution_mode: 'simple', current_phase: null, dod_content: null });
  });
  it.each(['idx_projects_execution_mode', 'idx_projects_current_phase'])('D1: 创建部分索引 %s', async (name) => {
    const result = await pool.query('SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexname = $2', ['projects', name]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indexdef).toContain('WHERE');
  });
  it('D1: 拒绝未知 task_type', async () => {
    await expect(pool.query("INSERT INTO tasks(title,task_type) VALUES ('bad-type','debt_invalid_type')")).rejects.toMatchObject({ code: '23514', constraint: 'tasks_task_type_check' });
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
      INSERT INTO goals (title, priority, status, progress)
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
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal'");
  });

  // D1: tasks.task_type CHECK 扩展 - initiative_verify
  it('D1: tasks.task_type accepts initiative_verify', async () => {
    const krResult = await pool.query(`
      INSERT INTO goals (title, priority, status, progress)
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
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal_v'");
  });

  // D1: existing task types still work
  it('D1: existing task types still accepted', async () => {
    const krResult = await pool.query(`
      INSERT INTO goals (title, priority, status, progress)
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
    await pool.query("DELETE FROM goals WHERE title = 'mig057_test_goal_existing'");
  });
});

afterAll(closeFixture);
