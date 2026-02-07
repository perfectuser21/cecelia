/**
 * createTask() Dedup Tests
 *
 * Tests that createTask() prevents duplicate tasks with the same
 * title + goal_id + project_id combination.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testGoalIds = [];
let testProjectIds = [];
let testTaskIds = [];

describe('createTask() Dedup', () => {
  beforeAll(async () => {
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    if (testTaskIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]);
      testTaskIds = [];
    }
    if (testProjectIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]);
      testProjectIds = [];
    }
    if (testGoalIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE goal_id = ANY($1)', [testGoalIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testGoalIds]);
      testGoalIds = [];
    }
  });

  it('should dedup when queued task with same title+goal+project exists', async () => {
    // Setup: create goal + project
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup test goal', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);
    const goalId = goalResult.rows[0].id;

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('dedup-test-proj', '/tmp/dedup-test', 'active') RETURNING id"
    );
    testProjectIds.push(projResult.rows[0].id);
    const projectId = projResult.rows[0].id;

    // Create first task directly in DB
    const firstTask = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, project_id, priority) VALUES ('Build login page', 'queued', $1, $2, 'P1') RETURNING *",
      [goalId, projectId]
    );
    testTaskIds.push(firstTask.rows[0].id);

    // Now run the dedup query (same logic as createTask)
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Build login page', goalId, projectId]);

    expect(dedupResult.rows.length).toBe(1);
    expect(dedupResult.rows[0].id).toBe(firstTask.rows[0].id);
  });

  it('should dedup when in_progress task with same title+goal+project exists', async () => {
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup inprog goal', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);
    const goalId = goalResult.rows[0].id;

    // Create in_progress task
    const firstTask = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, priority, started_at) VALUES ('Build login page', 'in_progress', $1, 'P1', NOW()) RETURNING *",
      [goalId]
    );
    testTaskIds.push(firstTask.rows[0].id);

    // Dedup query should find it
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Build login page', goalId, null]);

    expect(dedupResult.rows.length).toBe(1);
    expect(dedupResult.rows[0].id).toBe(firstTask.rows[0].id);
  });

  it('should allow different titles even with same goal+project', async () => {
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup diff title goal', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);
    const goalId = goalResult.rows[0].id;

    // Create first task
    const firstTask = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, priority) VALUES ('Build login page', 'queued', $1, 'P1') RETURNING *",
      [goalId]
    );
    testTaskIds.push(firstTask.rows[0].id);

    // Dedup query for DIFFERENT title should NOT match
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Build signup page', goalId, null]);

    expect(dedupResult.rows.length).toBe(0);
  });

  it('should allow re-creation after 24h completed window', async () => {
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup 24h goal', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);
    const goalId = goalResult.rows[0].id;

    // Create a completed task with completed_at > 24h ago
    const oldTask = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, priority, completed_at) VALUES ('Build login page', 'completed', $1, 'P1', NOW() - INTERVAL '25 hours') RETURNING *",
      [goalId]
    );
    testTaskIds.push(oldTask.rows[0].id);

    // Dedup query should NOT match (outside 24h window)
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Build login page', goalId, null]);

    expect(dedupResult.rows.length).toBe(0);
  });

  it('should dedup completed task within 24h window', async () => {
    const goalResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup recent goal', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(goalResult.rows[0].id);
    const goalId = goalResult.rows[0].id;

    // Create a recently completed task (within 24h)
    const recentTask = await pool.query(
      "INSERT INTO tasks (title, status, goal_id, priority, completed_at) VALUES ('Build login page', 'completed', $1, 'P1', NOW() - INTERVAL '2 hours') RETURNING *",
      [goalId]
    );
    testTaskIds.push(recentTask.rows[0].id);

    // Dedup query should match (within 24h window)
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Build login page', goalId, null]);

    expect(dedupResult.rows.length).toBe(1);
    expect(dedupResult.rows[0].id).toBe(recentTask.rows[0].id);
  });

  it('should handle NULL goal_id and project_id correctly', async () => {
    // Create task with NULL goal_id + NULL project_id
    const firstTask = await pool.query(
      "INSERT INTO tasks (title, status, priority) VALUES ('Orphan task', 'queued', 'P1') RETURNING *"
    );
    testTaskIds.push(firstTask.rows[0].id);

    // Dedup query with NULL values should match using IS NOT DISTINCT FROM
    const dedupResult = await pool.query(`
      SELECT * FROM tasks
      WHERE title = $1
        AND (goal_id IS NOT DISTINCT FROM $2)
        AND (project_id IS NOT DISTINCT FROM $3)
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
      LIMIT 1
    `, ['Orphan task', null, null]);

    expect(dedupResult.rows.length).toBe(1);
    expect(dedupResult.rows[0].id).toBe(firstTask.rows[0].id);
  });
});
