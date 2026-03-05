/**
 * Tests for KR progress backfill and update mechanism
 *
 * Covers:
 * - Task goal_id backfilling from project_kr_links
 * - KR progress calculation after backfill
 * - API endpoints for KR progress sync
 */

import { test, expect, beforeAll, afterAll } from 'vitest';
import pool from '../db.js';
import { updateKrProgress, syncAllKrProgress } from '../kr-progress.js';

let testKrId;
let testProjectId;
let testInitiativeId;
let testTaskId;

beforeAll(async () => {
  // Create test data: KR -> Project -> Initiative -> Task
  const krResult = await pool.query(`
    INSERT INTO goals (title, type, status, progress)
    VALUES ('Test KR for Progress', 'kr', 'in_progress', 0)
    RETURNING id
  `);
  testKrId = krResult.rows[0].id;

  const projectResult = await pool.query(`
    INSERT INTO projects (name, type, status, parent_id)
    VALUES ('Test Project', 'project', 'active', NULL)
    RETURNING id
  `);
  testProjectId = projectResult.rows[0].id;

  await pool.query(`
    INSERT INTO project_kr_links (project_id, kr_id)
    VALUES ($1, $2)
  `, [testProjectId, testKrId]);

  const initiativeResult = await pool.query(`
    INSERT INTO projects (name, type, status, parent_id)
    VALUES ('Test Initiative', 'initiative', 'completed', $1)
    RETURNING id
  `, [testProjectId]);
  testInitiativeId = initiativeResult.rows[0].id;

  const taskResult = await pool.query(`
    INSERT INTO tasks (title, description, status, project_id, goal_id)
    VALUES ('Test Task', 'Test backfill', 'completed', $1, NULL)
    RETURNING id
  `, [testInitiativeId]);
  testTaskId = taskResult.rows[0].id;
});

afterAll(async () => {
  // Clean up test data (order matters: delete children before parents)
  await pool.query('DELETE FROM tasks WHERE id = $1', [testTaskId]);
  await pool.query('DELETE FROM projects WHERE id = $1', [testInitiativeId]);
  await pool.query('DELETE FROM project_kr_links WHERE project_id = $1', [testProjectId]);
  await pool.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
  await pool.query('DELETE FROM goals WHERE id = $1', [testKrId]);
  await pool.end();
});

test('updateKrProgress calculates progress correctly', async () => {
  const result = await updateKrProgress(pool, testKrId);

  expect(result.krId).toBe(testKrId);
  expect(result.total).toBeGreaterThan(0);
  expect(result.progress).toBeGreaterThanOrEqual(0);
  expect(result.progress).toBeLessThanOrEqual(100);

  // Verify database was updated
  const krRow = await pool.query('SELECT progress FROM goals WHERE id = $1', [testKrId]);
  expect(krRow.rows[0].progress).toBe(result.progress);
});

test('syncAllKrProgress updates all in-progress KRs', async () => {
  const result = await syncAllKrProgress(pool);

  expect(result.updated).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(result.results)).toBe(true);
});

test('backfilling task goal_id works', async () => {
  // Verify task initially has null goal_id
  const taskBefore = await pool.query('SELECT goal_id FROM tasks WHERE id = $1', [testTaskId]);
  expect(taskBefore.rows[0].goal_id).toBeNull();

  // Execute backfill logic (same as migration)
  await pool.query(`
    WITH task_kr_mapping AS (
      SELECT
        t.id AS task_id,
        pkl.kr_id
      FROM tasks t
      JOIN projects initiative ON initiative.id = t.project_id AND initiative.type = 'initiative'
      JOIN projects project ON project.id = initiative.parent_id AND project.type = 'project'
      JOIN project_kr_links pkl ON pkl.project_id = project.id
      WHERE t.id = $1 AND t.goal_id IS NULL
    )
    UPDATE tasks
    SET goal_id = task_kr_mapping.kr_id
    FROM task_kr_mapping
    WHERE tasks.id = task_kr_mapping.task_id
  `, [testTaskId]);

  // Verify task now has correct goal_id
  const taskAfter = await pool.query('SELECT goal_id FROM tasks WHERE id = $1', [testTaskId]);
  expect(taskAfter.rows[0].goal_id).toBe(testKrId);
});
