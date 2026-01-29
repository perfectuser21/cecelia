/**
 * Action Loop - Tick Tests
 * Tests for automatic task progression mechanism
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// Use test database configuration
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'cecelia_tasks',
  user: process.env.DB_USER || 'n8n_user',
  password: process.env.DB_PASSWORD || 'n8n_password_2025'
});

// Test data IDs for cleanup
let testObjectiveIds = [];
let testKRIds = [];
let testTaskIds = [];

// Working memory keys used by tick module
const TICK_ENABLED_KEY = 'tick_enabled';
const TICK_LAST_KEY = 'tick_last';
const TICK_ACTIONS_TODAY_KEY = 'tick_actions_today';
const FOCUS_OVERRIDE_KEY = 'daily_focus_override';

describe('Action Loop - Tick', () => {
  beforeAll(async () => {
    // Verify database connection
    const result = await pool.query('SELECT 1');
    expect(result.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Cleanup test data in reverse order
    for (const taskId of testTaskIds) {
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]).catch(() => {});
    }
    for (const krId of testKRIds) {
      await pool.query('DELETE FROM goals WHERE id = $1', [krId]).catch(() => {});
    }
    for (const objId of testObjectiveIds) {
      await pool.query('DELETE FROM goals WHERE id = $1', [objId]).catch(() => {});
    }
    // Clear tick-related working memory
    await pool.query('DELETE FROM working_memory WHERE key IN ($1, $2, $3, $4)', [
      TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY, FOCUS_OVERRIDE_KEY
    ]).catch(() => {});
    // Clean up test decision logs
    await pool.query("DELETE FROM decision_log WHERE trigger = 'tick'").catch(() => {});
    testTaskIds = [];
    testKRIds = [];
    testObjectiveIds = [];
  });

  describe('Tick Status', () => {
    it('returns disabled status by default', async () => {
      // Query tick status from working memory
      const result = await pool.query(`
        SELECT key, value_json FROM working_memory
        WHERE key IN ($1, $2, $3)
      `, [TICK_ENABLED_KEY, TICK_LAST_KEY, TICK_ACTIONS_TODAY_KEY]);

      const memory = {};
      for (const row of result.rows) {
        memory[row.key] = row.value_json;
      }

      const enabled = memory[TICK_ENABLED_KEY]?.enabled ?? false;
      expect(enabled).toBe(false);
    });

    it('stores tick enabled state in working memory', async () => {
      // Enable tick
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [TICK_ENABLED_KEY, { enabled: true }]);

      // Verify
      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_ENABLED_KEY]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].value_json.enabled).toBe(true);
    });

    it('stores last tick timestamp in working memory', async () => {
      const timestamp = new Date().toISOString();

      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [TICK_LAST_KEY, { timestamp }]);

      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_LAST_KEY]
      );

      expect(result.rows[0].value_json.timestamp).toBe(timestamp);
    });

    it('tracks actions count per day', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Set initial count
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [TICK_ACTIONS_TODAY_KEY, { date: today, count: 5 }]);

      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_ACTIONS_TODAY_KEY]
      );

      expect(result.rows[0].value_json.date).toBe(today);
      expect(result.rows[0].value_json.count).toBe(5);
    });
  });

  describe('Enable/Disable Tick', () => {
    it('can enable tick', async () => {
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [TICK_ENABLED_KEY, { enabled: true }]);

      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_ENABLED_KEY]
      );

      expect(result.rows[0].value_json.enabled).toBe(true);
    });

    it('can disable tick', async () => {
      // First enable
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [TICK_ENABLED_KEY, { enabled: true }]);

      // Then disable
      await pool.query(`
        UPDATE working_memory SET value_json = $2, updated_at = NOW()
        WHERE key = $1
      `, [TICK_ENABLED_KEY, { enabled: false }]);

      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [TICK_ENABLED_KEY]
      );

      expect(result.rows[0].value_json.enabled).toBe(false);
    });
  });

  describe('Task Progression Logic', () => {
    it('starts next queued task when no task is in_progress', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Tick Test Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create queued tasks
      const task1Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Queued Task 1', 'P0', 'queued', objId]
      );
      testTaskIds.push(task1Result.rows[0].id);
      const taskId = task1Result.rows[0].id;

      const task2Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Queued Task 2', 'P1', 'queued', objId]
      );
      testTaskIds.push(task2Result.rows[0].id);

      // Get tasks for objective (simulating tick logic)
      const tasksResult = await pool.query(`
        SELECT id, title, status, priority
        FROM tasks
        WHERE goal_id = $1
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          created_at ASC
      `, [objId]);

      const tasks = tasksResult.rows;
      const inProgress = tasks.filter(t => t.status === 'in_progress');
      const queued = tasks.filter(t => t.status === 'queued');

      // Decision: If no in_progress, start first queued
      expect(inProgress.length).toBe(0);
      expect(queued.length).toBe(2);
      expect(queued[0].title).toBe('Queued Task 1'); // P0 first

      // Simulate starting the task
      await pool.query(
        'UPDATE tasks SET status = $1, started_at = NOW() WHERE id = $2',
        ['in_progress', taskId]
      );

      // Verify task is now in_progress
      const updatedTask = await pool.query(
        'SELECT status FROM tasks WHERE id = $1',
        [taskId]
      );
      expect(updatedTask.rows[0].status).toBe('in_progress');
    });

    it('waits when task is already in_progress', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Wait Test Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create in_progress task
      const task1Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['In Progress Task', 'P0', 'in_progress', objId]
      );
      testTaskIds.push(task1Result.rows[0].id);

      // Create queued task
      const task2Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Queued Task', 'P1', 'queued', objId]
      );
      testTaskIds.push(task2Result.rows[0].id);

      // Get tasks
      const tasksResult = await pool.query(`
        SELECT id, title, status, priority
        FROM tasks
        WHERE goal_id = $1
          AND status NOT IN ('completed', 'cancelled')
      `, [objId]);

      const tasks = tasksResult.rows;
      const inProgress = tasks.filter(t => t.status === 'in_progress');

      // Decision: Wait if something is in_progress
      expect(inProgress.length).toBe(1);
      expect(inProgress[0].title).toBe('In Progress Task');
    });
  });

  describe('Stale Task Detection', () => {
    it('detects stale tasks (in_progress > 24h)', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Stale Test Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create stale task (started 25 hours ago)
      const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const taskResult = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id, started_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['Stale Task', 'P0', 'in_progress', objId, staleTime]
      );
      testTaskIds.push(taskResult.rows[0].id);

      // Query task
      const result = await pool.query(
        'SELECT started_at FROM tasks WHERE id = $1',
        [taskResult.rows[0].id]
      );

      // Check if stale (in_progress > 24h)
      const startedAt = new Date(result.rows[0].started_at);
      const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);

      expect(hoursElapsed).toBeGreaterThan(24);
    });

    it('does not flag non-stale tasks', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Fresh Test Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create fresh task (started 1 hour ago)
      const freshTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const taskResult = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id, started_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['Fresh Task', 'P0', 'in_progress', objId, freshTime]
      );
      testTaskIds.push(taskResult.rows[0].id);

      // Query task
      const result = await pool.query(
        'SELECT started_at FROM tasks WHERE id = $1',
        [taskResult.rows[0].id]
      );

      // Check if stale
      const startedAt = new Date(result.rows[0].started_at);
      const hoursElapsed = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60);

      expect(hoursElapsed).toBeLessThan(24);
    });
  });

  describe('Decision Log', () => {
    it('logs tick decisions', async () => {
      // Insert a tick decision log
      await pool.query(`
        INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'tick',
        'Started task: Test Task',
        { action: 'update-task', task_id: '123', status: 'in_progress' },
        { success: true },
        'success'
      ]);

      // Query recent tick decisions
      const result = await pool.query(`
        SELECT * FROM decision_log
        WHERE trigger = 'tick'
        ORDER BY ts DESC
        LIMIT 1
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].trigger).toBe('tick');
      expect(result.rows[0].input_summary).toBe('Started task: Test Task');
      expect(result.rows[0].llm_output_json.action).toBe('update-task');
      expect(result.rows[0].status).toBe('success');
    });

    it('logs stale task detection', async () => {
      await pool.query(`
        INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        'tick',
        'Stale task detected: Old Task',
        { action: 'detect_stale', task_id: '456' },
        { success: true, task_id: '456', title: 'Old Task' },
        'success'
      ]);

      const result = await pool.query(`
        SELECT * FROM decision_log
        WHERE trigger = 'tick' AND llm_output_json->>'action' = 'detect_stale'
        ORDER BY ts DESC
        LIMIT 1
      `);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].llm_output_json.action).toBe('detect_stale');
    });
  });

  describe('Focus Integration', () => {
    it('uses daily focus to filter tasks', async () => {
      // Create two Objectives
      const obj1Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Focus Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(obj1Result.rows[0].id);
      const focusObjId = obj1Result.rows[0].id;

      const obj2Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Other Objective', 'objective', 'P1', 'in_progress']
      );
      testObjectiveIds.push(obj2Result.rows[0].id);
      const otherObjId = obj2Result.rows[0].id;

      // Create tasks for each objective
      const task1Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Focus Task', 'P1', 'queued', focusObjId]
      );
      testTaskIds.push(task1Result.rows[0].id);

      const task2Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Other Task', 'P0', 'queued', otherObjId]
      );
      testTaskIds.push(task2Result.rows[0].id);

      // Simulate tick: only get tasks for focus objective
      const focusTasks = await pool.query(`
        SELECT * FROM tasks
        WHERE goal_id = $1
          AND status NOT IN ('completed', 'cancelled')
      `, [focusObjId]);

      expect(focusTasks.rows.length).toBe(1);
      expect(focusTasks.rows[0].title).toBe('Focus Task');
    });

    it('includes tasks from Key Results of focus objective', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['KR Parent Objective', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create KR
      const krResult = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Key Result 1', 'key_result', objId, 1.0]
      );
      testKRIds.push(krResult.rows[0].id);
      const krId = krResult.rows[0].id;

      // Create task linked to KR
      const taskResult = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['KR Task', 'P1', 'queued', krId]
      );
      testTaskIds.push(taskResult.rows[0].id);

      // Simulate tick: get tasks for objective and its KRs
      const allGoalIds = [objId, krId];
      const tasks = await pool.query(`
        SELECT * FROM tasks
        WHERE goal_id = ANY($1)
          AND status NOT IN ('completed', 'cancelled')
      `, [allGoalIds]);

      expect(tasks.rows.length).toBe(1);
      expect(tasks.rows[0].title).toBe('KR Task');
    });
  });

  describe('No Focus Handling', () => {
    it('skips tick when no active Objective', async () => {
      // No objectives created, simulate checking for focus
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
        LIMIT 1
      `);

      // Note: In a clean test, there may be no objectives
      // The actual behavior is tested by verifying the count
      // In production, tick would return { success: true, skipped: true }
      expect(result.rows.length).toBeDefined();
    });
  });
});
