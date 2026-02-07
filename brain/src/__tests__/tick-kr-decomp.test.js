/**
 * Tick KR Auto-Decomposition Tests
 *
 * Tests the Step 6c logic: when planNextTask returns needs_planning,
 * auto-create a KR decomposition task for 秋米 to pick up.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testGoalIds = [];
let testProjectIds = [];
let testTaskIds = [];

describe('Tick KR Auto-Decomposition (Step 6c)', () => {
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

  it('should create KR decomposition task when none exists', async () => {
    // Setup: create KR + project
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Test KR for decomp', 'key_result', 'P0', 'pending', 0) RETURNING id, title"
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;
    const krTitle = krResult.rows[0].title;

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('decomp-test-proj', '/tmp/decomp-test', 'active') RETURNING id"
    );
    testProjectIds.push(projResult.rows[0].id);
    const projectId = projResult.rows[0].id;

    // Step 1: Dedup check — should find nothing
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    `, [krId]);

    expect(existingDecomp.rows.length).toBe(0);

    // Step 2: Create decomposition task (mirrors tick.js 6c logic)
    const decompResult = await pool.query(`
      INSERT INTO tasks (title, description, status, priority, goal_id, project_id, task_type, payload, trigger_source)
      VALUES ($1, $2, 'queued', 'P0', $3, $4, 'dev', $5, 'brain_auto')
      RETURNING id, title, goal_id, project_id, trigger_source, payload
    `, [
      `KR 拆解: ${krTitle}`,
      `请为 KR「${krTitle}」创建具体执行任务。`,
      krId,
      projectId,
      JSON.stringify({ decomposition: 'continue', kr_id: krId })
    ]);
    testTaskIds.push(decompResult.rows[0].id);

    // Verify created task
    const task = decompResult.rows[0];
    expect(task.title).toBe(`KR 拆解: ${krTitle}`);
    expect(task.goal_id).toBe(krId);
    expect(task.project_id).toBe(projectId);
    expect(task.trigger_source).toBe('brain_auto');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.decomposition).toBe('continue');
    expect(payload.kr_id).toBe(krId);
  });

  it('should NOT create duplicate when decomposition task already exists (queued)', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Dedup KR', 'key_result', 'P0', 'pending', 0) RETURNING id, title"
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // Pre-create a queued decomposition task
    const existingTask = await pool.query(`
      INSERT INTO tasks (title, status, priority, goal_id, task_type, payload, trigger_source)
      VALUES ($1, 'queued', 'P0', $2, 'dev', $3, 'brain_auto')
      RETURNING id
    `, [
      `KR 拆解: Dedup KR`,
      krId,
      JSON.stringify({ decomposition: 'continue', kr_id: krId })
    ]);
    testTaskIds.push(existingTask.rows[0].id);

    // Dedup check — should find the existing task
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    `, [krId]);

    expect(existingDecomp.rows.length).toBe(1);
    expect(existingDecomp.rows[0].id).toBe(existingTask.rows[0].id);
  });

  it('should NOT create duplicate when decomposition task is in_progress', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('InProgress KR', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // Pre-create an in_progress decomposition task
    const existingTask = await pool.query(`
      INSERT INTO tasks (title, status, priority, goal_id, task_type, payload, trigger_source)
      VALUES ('KR 拆解: InProgress KR', 'in_progress', 'P0', $1, 'dev', $2, 'brain_auto')
      RETURNING id
    `, [krId, JSON.stringify({ decomposition: 'continue', kr_id: krId })]);
    testTaskIds.push(existingTask.rows[0].id);

    // Dedup check
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    `, [krId]);

    expect(existingDecomp.rows.length).toBe(1);
  });

  it('should allow creation when old decomposition task is completed > 24h ago', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Old Completed KR', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // Pre-create a completed task from 2 days ago
    const oldTask = await pool.query(`
      INSERT INTO tasks (title, status, priority, goal_id, task_type, payload, trigger_source, completed_at)
      VALUES ('KR 拆解: Old Completed KR', 'completed', 'P0', $1, 'dev', $2, 'brain_auto', NOW() - INTERVAL '48 hours')
      RETURNING id
    `, [krId, JSON.stringify({ decomposition: 'continue', kr_id: krId })]);
    testTaskIds.push(oldTask.rows[0].id);

    // Dedup check — old completed task should NOT block new creation
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    `, [krId]);

    expect(existingDecomp.rows.length).toBe(0);
  });

  it('should detect decomposition task by title pattern (拆解)', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Title Pattern KR', 'key_result', 'P0', 'pending', 0) RETURNING id"
    );
    testGoalIds.push(krResult.rows[0].id);
    const krId = krResult.rows[0].id;

    // Task with 拆解 in title but no decomposition payload
    const titleTask = await pool.query(`
      INSERT INTO tasks (title, status, priority, goal_id, task_type, payload, trigger_source)
      VALUES ('OKR 拆解: Title Pattern KR', 'queued', 'P0', $1, 'dev', '{}', 'brain_auto')
      RETURNING id
    `, [krId]);
    testTaskIds.push(titleTask.rows[0].id);

    // Dedup check — should detect by title pattern
    const existingDecomp = await pool.query(`
      SELECT id FROM tasks
      WHERE goal_id = $1
        AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')
        AND (status IN ('queued', 'in_progress') OR (status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'))
    `, [krId]);

    expect(existingDecomp.rows.length).toBe(1);
  });
});
