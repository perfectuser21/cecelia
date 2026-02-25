/**
 * decomposition-checker.test.js
 *
 * Tests the 4-layer kr_id fallback chain in checkInitiativeDecomposition().
 *
 * Fallback order:
 *   1. project_kr_links WHERE project_id = parent_id
 *   2. projects.kr_id WHERE id = initiative.id
 *   3. projects.kr_id WHERE id = parent_id
 *   4. project_kr_links WHERE project_id = initiative.id
 *   5. null → skip (no task created)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { checkInitiativeDecomposition } from '../decomposition-checker.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let cleanupGoalIds = [];
let cleanupProjectIds = [];
let cleanupLinkRows = [];  // { project_id, kr_id }

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
  cleanupLinkRows.push({ project_id: projectId, kr_id: krId });
}

describe('decomposition-checker: checkInitiativeDecomposition kr_id fallback', () => {
  beforeAll(async () => {
    const r = await pool.query('SELECT 1');
    expect(r.rows[0]['?column?']).toBe(1);
  });

  afterAll(async () => {
    await pool.end();
  });

  afterEach(async () => {
    // Clean up tasks referencing test projects
    if (cleanupProjectIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [cleanupProjectIds]).catch(() => {});
      // Clean kr links
      for (const { project_id, kr_id } of cleanupLinkRows) {
        await pool.query('DELETE FROM project_kr_links WHERE project_id=$1 AND kr_id=$2', [project_id, kr_id]).catch(() => {});
      }
      await pool.query('DELETE FROM projects WHERE id = ANY($1)', [cleanupProjectIds]).catch(() => {});
      cleanupProjectIds = [];
      cleanupLinkRows = [];
    }
    if (cleanupGoalIds.length > 0) {
      await pool.query('DELETE FROM tasks WHERE goal_id = ANY($1)', [cleanupGoalIds]).catch(() => {});
      await pool.query('DELETE FROM goals WHERE id = ANY($1)', [cleanupGoalIds]).catch(() => {});
      cleanupGoalIds = [];
    }
  });

  it('should find kr_id via initiative self kr_id (Layer 2)', async () => {
    const krId = await createKr('Layer2 KR');
    const parentId = await createProject('Layer2 Parent', { type: 'project' });
    // initiative has kr_id directly set, no project_kr_links on parent
    const initId = await createProject('Layer2 Initiative', {
      type: 'initiative', parentId, krId
    });

    const actions = await checkInitiativeDecomposition();

    // Should have created a task for this initiative
    const task = await pool.query(
      'SELECT goal_id FROM tasks WHERE project_id = $1 AND status = $2 LIMIT 1',
      [initId, 'queued']
    );
    expect(task.rows.length).toBe(1);
    expect(task.rows[0].goal_id).toBe(krId);

    // Also verify action returned
    const created = actions.filter(a => a.action === 'create_decomposition' && a.initiative_id === initId);
    expect(created.length).toBe(1);
  });

  it('should find kr_id via parent project kr_id (Layer 3)', async () => {
    const krId = await createKr('Layer3 KR');
    // Parent project has kr_id, no kr_links, initiative has no kr_id
    const parentId = await createProject('Layer3 Parent', { type: 'project', krId });
    const initId = await createProject('Layer3 Initiative', { type: 'initiative', parentId });

    const actions = await checkInitiativeDecomposition();

    const task = await pool.query(
      'SELECT goal_id FROM tasks WHERE project_id = $1 AND status = $2 LIMIT 1',
      [initId, 'queued']
    );
    expect(task.rows.length).toBe(1);
    expect(task.rows[0].goal_id).toBe(krId);

    const created = actions.filter(a => a.action === 'create_decomposition' && a.initiative_id === initId);
    expect(created.length).toBe(1);
  });

  it('should find kr_id via initiative own project_kr_links (Layer 4)', async () => {
    const krId = await createKr('Layer4 KR');
    const parentId = await createProject('Layer4 Parent', { type: 'project' });
    const initId = await createProject('Layer4 Initiative', { type: 'initiative', parentId });
    // Only link is on initiative itself (not parent)
    await addKrLink(initId, krId);

    const actions = await checkInitiativeDecomposition();

    const task = await pool.query(
      'SELECT goal_id FROM tasks WHERE project_id = $1 AND status = $2 LIMIT 1',
      [initId, 'queued']
    );
    expect(task.rows.length).toBe(1);
    expect(task.rows[0].goal_id).toBe(krId);

    const created = actions.filter(a => a.action === 'create_decomposition' && a.initiative_id === initId);
    expect(created.length).toBe(1);
  });

  it('should skip task creation when all fallbacks return null', async () => {
    const parentId = await createProject('NoKR Parent', { type: 'project' });
    const initId = await createProject('NoKR Initiative', { type: 'initiative', parentId });
    // No kr_id on parent, no kr_id on initiative, no kr_links anywhere

    const actions = await checkInitiativeDecomposition();

    // No task should be created
    const task = await pool.query(
      'SELECT goal_id FROM tasks WHERE project_id = $1 AND status = $2 LIMIT 1',
      [initId, 'queued']
    );
    expect(task.rows.length).toBe(0);

    // Should not appear as 'create_decomposition'
    const created = actions.filter(a => a.action === 'create_decomposition' && a.initiative_id === initId);
    expect(created.length).toBe(0);
  });

});
