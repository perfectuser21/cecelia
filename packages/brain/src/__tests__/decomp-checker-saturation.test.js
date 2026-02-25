/**
 * decomp-checker-saturation.test.js
 *
 * Tests for:
 * 1. manual_mode — when enabled, runDecompositionChecks() should skip entirely
 * 2. KR saturation — when a KR already has >= 3 active tasks, skip decomposition
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { runDecompositionChecks, checkInitiativeDecomposition } from '../decomposition-checker.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let cleanupGoalIds = [];
let cleanupProjectIds = [];
let cleanupTaskIds = [];

async function createKr(title = 'Test KR') {
  const r = await pool.query(
    "INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, 'kr', 'P1', 'pending', 0) RETURNING id",
    [title]
  );
  cleanupGoalIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function createProject(name, { type = 'project', parentId = null, krId = null } = {}) {
  const r = await pool.query(
    `INSERT INTO projects (name, type, status, parent_id, kr_id)
     VALUES ($1, $2, 'active', $3, $4) RETURNING id`,
    [name, type, parentId, krId]
  );
  cleanupProjectIds.push(r.rows[0].id);
  return r.rows[0].id;
}

async function addKrLink(projectId, krId) {
  await pool.query(
    `INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2)
     ON CONFLICT (project_id, kr_id) DO NOTHING`,
    [projectId, krId]
  );
}

async function createTask(title, { goalId, projectId, status = 'queued' }) {
  const r = await pool.query(
    `INSERT INTO tasks (title, status, priority, goal_id, project_id, task_type)
     VALUES ($1, $2, 'P1', $3, $4, 'dev') RETURNING id`,
    [title, status, goalId, projectId]
  );
  cleanupTaskIds.push(r.rows[0].id);
  return r.rows[0].id;
}

describe('decomp-checker: manual_mode', () => {
  beforeAll(async () => {
    const r = await pool.query('SELECT 1');
    expect(r.rows[0]['?column?']).toBe(1);
  });

  afterEach(async () => {
    // Clean up manual_mode from working_memory
    await pool.query("DELETE FROM working_memory WHERE key = 'manual_mode'");
  });

  it('should skip all checks when manual_mode is enabled', async () => {
    // Enable manual mode
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('manual_mode', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [{ enabled: true }]);

    const result = await runDecompositionChecks();

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('manual_mode');
    expect(result.total_created).toBe(0);
  });

  it('should run normally when manual_mode is disabled', async () => {
    // Disable manual mode
    await pool.query(`
      INSERT INTO working_memory (key, value_json, updated_at)
      VALUES ('manual_mode', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()
    `, [{ enabled: false }]);

    const result = await runDecompositionChecks();

    // Should NOT be skipped (manual_mode disabled)
    expect(result.skipped).toBeUndefined();
  });

  it('should run normally when manual_mode key does not exist', async () => {
    // Ensure no manual_mode key
    await pool.query("DELETE FROM working_memory WHERE key = 'manual_mode'");

    const result = await runDecompositionChecks();

    expect(result.skipped).toBeUndefined();
  });
});

describe('decomp-checker: KR saturation (Check 6)', () => {
  let krId;
  let projectId;
  let initiativeId;       // empty initiative (no tasks) — check 6 target
  let otherInitiativeId;  // sibling initiative that holds the active tasks

  beforeAll(async () => {
    // Create KR -> Project -> 2 Initiatives
    // initiativeId: empty (check 6 will find it)
    // otherInitiativeId: has active tasks under the same KR
    krId = await createKr('Saturation Test KR');
    projectId = await createProject('Saturation Test Project');
    await addKrLink(projectId, krId);
    initiativeId = await createProject('Empty Initiative (Check 6 target)', {
      type: 'initiative',
      parentId: projectId,
    });
    otherInitiativeId = await createProject('Busy Initiative (sibling)', {
      type: 'initiative',
      parentId: projectId,
    });
  });

  afterEach(async () => {
    // Clean up tasks created during tests
    if (cleanupTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1)`, [cleanupTaskIds]);
      cleanupTaskIds = [];
    }
    // Also clean up any decomposition tasks created by the checker for our initiatives
    await pool.query(
      `DELETE FROM tasks WHERE project_id = ANY($1) AND (payload->>'decomposition' IN ('true', 'continue') OR title LIKE '%拆解%')`,
      [[initiativeId, otherInitiativeId]]
    );
  });

  afterAll(async () => {
    // Clean up in reverse order
    if (cleanupTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1)`, [cleanupTaskIds]);
    }
    await pool.query(`DELETE FROM tasks WHERE project_id = ANY($1)`, [cleanupProjectIds]);
    for (const pid of cleanupProjectIds) {
      await pool.query(`DELETE FROM project_kr_links WHERE project_id = $1`, [pid]);
    }
    for (const pid of [...cleanupProjectIds].reverse()) {
      await pool.query(`DELETE FROM projects WHERE id = $1`, [pid]);
    }
    for (const gid of cleanupGoalIds) {
      await pool.query(`DELETE FROM goals WHERE id = $1`, [gid]);
    }
    await pool.end();
  });

  it('should skip empty initiative when sibling KR has >= 3 active tasks', async () => {
    // The sibling initiative has 3 active tasks under the same KR
    // Even though initiativeId itself has no tasks (so check 6 finds it),
    // the KR saturation check should prevent creating a decomp task for it
    await createTask('Sibling task 1', { goalId: krId, projectId: otherInitiativeId, status: 'queued' });
    await createTask('Sibling task 2', { goalId: krId, projectId: otherInitiativeId, status: 'queued' });
    await createTask('Sibling task 3', { goalId: krId, projectId: otherInitiativeId, status: 'in_progress' });

    const actions = await checkInitiativeDecomposition();

    // Should have a skip_saturated action for our empty initiative
    const satAction = actions.find(
      a => a.action === 'skip_saturated' && a.initiative_id === initiativeId
    );
    expect(satAction).toBeDefined();
    expect(satAction.kr_id).toBe(krId);

    // Should NOT have a create_decomposition action for our empty initiative
    const createAction = actions.find(
      a => a.action === 'create_decomposition' && a.initiative_id === initiativeId
    );
    expect(createAction).toBeUndefined();
  });

  it('should create decomposition when KR has < 3 active tasks', async () => {
    // Only 1 active task under sibling, KR not saturated
    await createTask('Sibling task 1', { goalId: krId, projectId: otherInitiativeId, status: 'queued' });

    const actions = await checkInitiativeDecomposition();

    // Should NOT have skip_saturated for our initiative
    const satAction = actions.find(
      a => a.action === 'skip_saturated' && a.initiative_id === initiativeId
    );
    expect(satAction).toBeUndefined();
  });

  it('should not count completed tasks toward saturation', async () => {
    // 3 completed tasks under sibling — should NOT count
    await createTask('Completed 1', { goalId: krId, projectId: otherInitiativeId, status: 'completed' });
    await createTask('Completed 2', { goalId: krId, projectId: otherInitiativeId, status: 'completed' });
    await createTask('Completed 3', { goalId: krId, projectId: otherInitiativeId, status: 'completed' });

    const actions = await checkInitiativeDecomposition();

    // Should NOT have skip_saturated (completed tasks don't count)
    const satAction = actions.find(
      a => a.action === 'skip_saturated' && a.initiative_id === initiativeId
    );
    expect(satAction).toBeUndefined();
  });
});
