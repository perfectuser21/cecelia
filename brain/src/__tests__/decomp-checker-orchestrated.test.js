/**
 * Decomposition Checker - orchestrated 跳过测试
 *
 * DoD 覆盖: D4
 *
 * 验证 Check 6 (checkInitiativeDecomposition) 对 orchestrated initiative 的跳过行为。
 * 使用集成测试直接调用 DB。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pool from '../db.js';

let testIds = { projects: [], goals: [] };

async function cleanup() {
  // 清理顺序：tasks → projects → goals
  for (const pid of testIds.projects) {
    await pool.query('DELETE FROM tasks WHERE project_id = $1', [pid]).catch(() => {});
  }
  if (testIds.projects.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testIds.projects]);
    testIds.projects = [];
  }
  if (testIds.goals.length > 0) {
    await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testIds.goals]);
    testIds.goals = [];
  }
}

describe('decomposition-checker orchestrated skip', () => {
  afterAll(cleanup);

  it('D4: orchestrated initiative produces skip_orchestrated action', async () => {
    // 需要动态 import 因为 decomposition-checker 在顶层 import pool
    const { checkInitiativeDecomposition } = await import('../decomposition-checker.js');

    // Create parent project
    const parentResult = await pool.query(`
      INSERT INTO projects (name, type, status, description)
      VALUES ('decomp_test_parent', 'project', 'active', 'test')
      RETURNING id
    `);
    testIds.projects.push(parentResult.rows[0].id);

    // Create orchestrated initiative (active, no tasks → normally would trigger decomposition)
    const initResult = await pool.query(`
      INSERT INTO projects (name, type, status, parent_id, execution_mode, current_phase, description)
      VALUES ('decomp_test_orchestrated', 'initiative', 'active', $1, 'orchestrated', 'plan', 'test')
      RETURNING id
    `, [parentResult.rows[0].id]);
    testIds.projects.push(initResult.rows[0].id);

    // Run Check 6
    const actions = await checkInitiativeDecomposition();

    // Should have skip_orchestrated action for our initiative
    const skipped = actions.find(a =>
      a.action === 'skip_orchestrated' && a.initiative_id === initResult.rows[0].id
    );
    expect(skipped).toBeDefined();
    expect(skipped.check).toBe('initiative_decomposition');
  });
});
