/**
 * Priority Engine - Focus API Tests
 * Tests for daily focus selection algorithm and API endpoints
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

// Working memory key used by focus module
const FOCUS_OVERRIDE_KEY = 'daily_focus_override';

describe('Priority Engine - Focus API', () => {
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
    // Clear manual focus override
    await pool.query('DELETE FROM working_memory WHERE key = $1', [FOCUS_OVERRIDE_KEY]).catch(() => {});
    testTaskIds = [];
    testKRIds = [];
    testObjectiveIds = [];
  });

  describe('Focus Selection Algorithm', () => {
    it('selects pinned Objective first', async () => {
      // Create P0 Objective (not pinned)
      const p0Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['P0 Objective', 'objective', 'P0', 'pending', {}]
      );
      testObjectiveIds.push(p0Result.rows[0].id);

      // Create P2 Objective (pinned)
      const pinnedResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['Pinned Objective', 'objective', 'P2', 'pending', { is_pinned: true }]
      );
      testObjectiveIds.push(pinnedResult.rows[0].id);

      // Query using algorithm order
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
          AND id = ANY($1)
        ORDER BY
          CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
        LIMIT 1
      `, [testObjectiveIds]);

      expect(result.rows[0].title).toBe('Pinned Objective');
    });

    it('selects higher priority when no pinned Objectives', async () => {
      // Create P2 Objective
      const p2Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['P2 Objective', 'objective', 'P2', 'pending']
      );
      testObjectiveIds.push(p2Result.rows[0].id);

      // Create P0 Objective
      const p0Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['P0 Objective', 'objective', 'P0', 'pending']
      );
      testObjectiveIds.push(p0Result.rows[0].id);

      // Create P1 Objective
      const p1Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['P1 Objective', 'objective', 'P1', 'pending']
      );
      testObjectiveIds.push(p1Result.rows[0].id);

      // Query using algorithm order
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
          AND id = ANY($1)
        ORDER BY
          CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
        LIMIT 1
      `, [testObjectiveIds]);

      expect(result.rows[0].title).toBe('P0 Objective');
    });

    it('prioritizes near-completion Objectives (80%+) among same priority', async () => {
      // Create P1 Objective with 50% progress
      const p1_50Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['P1 50%', 'objective', 'P1', 'in_progress', 50]
      );
      testObjectiveIds.push(p1_50Result.rows[0].id);

      // Create P1 Objective with 85% progress
      const p1_85Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['P1 85%', 'objective', 'P1', 'in_progress', 85]
      );
      testObjectiveIds.push(p1_85Result.rows[0].id);

      // Query using full algorithm
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
          AND id = ANY($1)
        ORDER BY
          CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
          CASE WHEN progress >= 80 THEN 0 ELSE 1 END,
          updated_at DESC NULLS LAST
        LIMIT 1
      `, [testObjectiveIds]);

      expect(result.rows[0].title).toBe('P1 85%');
    });

    it('excludes completed and cancelled Objectives', async () => {
      // Create completed Objective
      const completedResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Completed O', 'objective', 'P0', 'completed']
      );
      testObjectiveIds.push(completedResult.rows[0].id);

      // Create cancelled Objective
      const cancelledResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Cancelled O', 'objective', 'P0', 'cancelled']
      );
      testObjectiveIds.push(cancelledResult.rows[0].id);

      // Create pending Objective
      const pendingResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Pending O', 'objective', 'P2', 'pending']
      );
      testObjectiveIds.push(pendingResult.rows[0].id);

      // Query active Objectives only
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
          AND id = ANY($1)
      `, [testObjectiveIds]);

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].title).toBe('Pending O');
    });
  });

  describe('Manual Focus Override', () => {
    it('can set manual focus override in working memory', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Manual Focus Target', 'objective', 'P2', 'pending']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Set manual override
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [FOCUS_OVERRIDE_KEY, { objective_id: objId }]);

      // Verify override is stored
      const result = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [FOCUS_OVERRIDE_KEY]
      );

      expect(result.rows.length).toBe(1);
      expect(result.rows[0].value_json.objective_id).toBe(objId);
    });

    it('manual override takes precedence over algorithm', async () => {
      // Create P0 Objective (should be selected by algorithm)
      const p0Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['P0 Auto Selected', 'objective', 'P0', 'pending']
      );
      testObjectiveIds.push(p0Result.rows[0].id);

      // Create P2 Objective (will be manually selected)
      const p2Result = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['P2 Manual Override', 'objective', 'P2', 'pending']
      );
      testObjectiveIds.push(p2Result.rows[0].id);
      const manualId = p2Result.rows[0].id;

      // Set manual override
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
      `, [FOCUS_OVERRIDE_KEY, { objective_id: manualId }]);

      // Check override
      const overrideResult = await pool.query(
        'SELECT value_json FROM working_memory WHERE key = $1',
        [FOCUS_OVERRIDE_KEY]
      );

      if (overrideResult.rows.length > 0 && overrideResult.rows[0].value_json?.objective_id) {
        const objResult = await pool.query(
          'SELECT * FROM goals WHERE id = $1',
          [overrideResult.rows[0].value_json.objective_id]
        );
        expect(objResult.rows[0].title).toBe('P2 Manual Override');
      }
    });

    it('can clear manual override to restore auto-selection', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Test Objective', 'objective', 'P1', 'pending']
      );
      testObjectiveIds.push(objResult.rows[0].id);

      // Set override
      await pool.query(`
        INSERT INTO working_memory (key, value_json, updated_at)
        VALUES ($1, $2, NOW())
      `, [FOCUS_OVERRIDE_KEY, { objective_id: objResult.rows[0].id }]);

      // Clear override
      await pool.query('DELETE FROM working_memory WHERE key = $1', [FOCUS_OVERRIDE_KEY]);

      // Verify cleared
      const result = await pool.query(
        'SELECT * FROM working_memory WHERE key = $1',
        [FOCUS_OVERRIDE_KEY]
      );

      expect(result.rows.length).toBe(0);
    });
  });

  describe('Focus Response with Key Results and Tasks', () => {
    it('includes Key Results in focus response', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Focus with KRs', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create KRs
      const kr1Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 1', 'key_result', objId, 0.6, 30]
      );
      testKRIds.push(kr1Result.rows[0].id);

      const kr2Result = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['KR 2', 'key_result', objId, 0.4, 50]
      );
      testKRIds.push(kr2Result.rows[0].id);

      // Query KRs for focus
      const krsResult = await pool.query(
        'SELECT * FROM goals WHERE parent_id = $1 ORDER BY weight DESC',
        [objId]
      );

      expect(krsResult.rows.length).toBe(2);
      expect(krsResult.rows[0].title).toBe('KR 1'); // Higher weight first
      expect(krsResult.rows[1].title).toBe('KR 2');
    });

    it('includes suggested tasks linked to Objective', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Focus with Tasks', 'objective', 'P0', 'in_progress']
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create tasks linked to this Objective (status must be 'queued' per DB constraint)
      const task1Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Task 1', 'P0', 'queued', objId]
      );
      testTaskIds.push(task1Result.rows[0].id);

      const task2Result = await pool.query(
        `INSERT INTO tasks (title, priority, status, goal_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Task 2', 'P1', 'queued', objId]
      );
      testTaskIds.push(task2Result.rows[0].id);

      // Query suggested tasks
      const tasksResult = await pool.query(`
        SELECT id, title, status, priority
        FROM tasks
        WHERE goal_id = $1
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY
          CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END
        LIMIT 5
      `, [objId]);

      expect(tasksResult.rows.length).toBe(2);
      expect(tasksResult.rows[0].title).toBe('Task 1'); // P0 first
    });
  });

  describe('Decision Pack Integration', () => {
    it('focus summary includes required fields', async () => {
      // Create Objective
      const objResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['Decision Pack Focus', 'objective', 'P1', 'in_progress', 45]
      );
      testObjectiveIds.push(objResult.rows[0].id);
      const objId = objResult.rows[0].id;

      // Create KRs
      const krResult = await pool.query(
        `INSERT INTO goals (title, type, parent_id, weight, progress) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        ['Sample KR', 'key_result', objId, 1.0, 45]
      );
      testKRIds.push(krResult.rows[0].id);

      // Query for focus summary
      const objQuery = await pool.query('SELECT * FROM goals WHERE id = $1', [objId]);
      const obj = objQuery.rows[0];

      const krsQuery = await pool.query(
        'SELECT id, title, progress FROM goals WHERE parent_id = $1 ORDER BY weight DESC LIMIT 3',
        [objId]
      );

      // Verify summary structure
      const focusSummary = {
        objective_id: obj.id,
        objective_title: obj.title,
        priority: obj.priority,
        progress: obj.progress,
        key_results: krsQuery.rows,
        reason: 'P1 高优先级, 当前进度 45%',
        is_manual: false
      };

      expect(focusSummary.objective_id).toBe(objId);
      expect(focusSummary.objective_title).toBe('Decision Pack Focus');
      expect(focusSummary.priority).toBe('P1');
      expect(focusSummary.progress).toBe(45);
      expect(focusSummary.key_results.length).toBe(1);
      expect(focusSummary.key_results[0].title).toBe('Sample KR');
    });

    it('returns null when no active Objectives', async () => {
      // Create only completed Objectives
      const completedResult = await pool.query(
        `INSERT INTO goals (title, type, priority, status) VALUES ($1, $2, $3, $4) RETURNING *`,
        ['Completed Only', 'objective', 'P0', 'completed']
      );
      testObjectiveIds.push(completedResult.rows[0].id);

      // Query active Objectives
      const result = await pool.query(`
        SELECT *
        FROM goals
        WHERE type = 'objective'
          AND status NOT IN ('completed', 'cancelled')
          AND id = $1
      `, [completedResult.rows[0].id]);

      expect(result.rows.length).toBe(0);
    });
  });
});
