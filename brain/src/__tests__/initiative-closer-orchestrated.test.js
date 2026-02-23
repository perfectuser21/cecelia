/**
 * Initiative Closer - orchestrated 跳过测试
 *
 * DoD 覆盖: D3
 */

import { describe, it, expect, afterAll } from 'vitest';
import pool from '../db.js';
import { checkInitiativeCompletion } from '../initiative-closer.js';

let testIds = { projects: [], tasks: [] };

async function cleanup() {
  if (testIds.tasks.length > 0) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testIds.tasks]);
    testIds.tasks = [];
  }
  if (testIds.projects.length > 0) {
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testIds.projects]);
    testIds.projects = [];
  }
}

describe('initiative-closer orchestrated skip', () => {
  afterAll(cleanup);

  it('D3: orchestrated initiative is skipped by closer', async () => {
    // Create parent project
    const parentResult = await pool.query(`
      INSERT INTO projects (name, type, status, description)
      VALUES ('closer_test_parent', 'project', 'active', 'test')
      RETURNING id
    `);
    testIds.projects.push(parentResult.rows[0].id);

    // Create orchestrated initiative (in_progress with orchestrator managing it)
    const initResult = await pool.query(`
      INSERT INTO projects (name, type, status, parent_id, execution_mode, current_phase, description)
      VALUES ('closer_test_orchestrated', 'initiative', 'in_progress', $1, 'orchestrated', 'dev', 'test')
      RETURNING id
    `, [parentResult.rows[0].id]);
    testIds.projects.push(initResult.rows[0].id);

    // Create a completed task (normally closer would close this initiative)
    const taskResult = await pool.query(`
      INSERT INTO tasks (title, task_type, status, project_id, priority)
      VALUES ('closer_test_task', 'dev', 'completed', $1, 'P1')
      RETURNING id
    `, [initResult.rows[0].id]);
    testIds.tasks.push(taskResult.rows[0].id);

    // Run closer
    const result = await checkInitiativeCompletion(pool);

    // Orchestrated initiative should NOT be closed
    const checkResult = await pool.query(
      'SELECT status FROM projects WHERE id = $1',
      [initResult.rows[0].id]
    );
    expect(checkResult.rows[0].status).toBe('in_progress');

    // Simple initiative (if any) would be closed, but orchestrated is skipped
    const closedIds = result.closed.map(c => c.id);
    expect(closedIds).not.toContain(initResult.rows[0].id);
  });
});
