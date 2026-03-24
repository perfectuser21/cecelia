/**
 * Planner Initiative Plan Tests
 * Tests for the enhanced Planner that detects "KR with active Initiative but no Task"
 * and auto-generates architecture_design tasks.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { scoreKRs, selectTargetProject, generateArchitectureDesignTask } from '../planner.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

// Track test data for cleanup
let testKRIds = [];
let testProjectIds = [];
let testTaskIds = [];
let testLinks = [];
let testOkrProjectIds = [];
let testOkrScopeIds = [];
let testOkrInitiativeIds = [];
let testKeyResultIds = [];

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  // Cleanup test tasks first (FK safety)
  if (testTaskIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]).catch(() => {});
    testTaskIds = [];
  }
  // Cleanup test links
  for (const link of testLinks) {
    await pool.query('DELETE FROM project_kr_links WHERE project_id = $1 AND kr_id = $2', [link.project_id, link.kr_id]).catch(() => {});
  }
  testLinks = [];
  // Delete tasks linked to test projects (FK safety)
  if (testProjectIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    testProjectIds = [];
  }
  // Cleanup OKR new-table test data (cascade order: initiatives → scopes → okr_projects)
  if (testOkrInitiativeIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE okr_initiative_id = ANY($1)', [testOkrInitiativeIds]).catch(() => {});
    await pool.query('DELETE FROM okr_initiatives WHERE id = ANY($1)', [testOkrInitiativeIds]).catch(() => {});
    testOkrInitiativeIds = [];
  }
  if (testOkrScopeIds.length > 0) {
    await pool.query('DELETE FROM okr_scopes WHERE id = ANY($1)', [testOkrScopeIds]).catch(() => {});
    testOkrScopeIds = [];
  }
  if (testOkrProjectIds.length > 0) {
    await pool.query('DELETE FROM okr_projects WHERE id = ANY($1)', [testOkrProjectIds]).catch(() => {});
    testOkrProjectIds = [];
  }
  if (testKeyResultIds.length > 0) {
    await pool.query('DELETE FROM okr_projects WHERE kr_id = ANY($1)', [testKeyResultIds]).catch(() => {});
    await pool.query('DELETE FROM key_results WHERE id = ANY($1)', [testKeyResultIds]).catch(() => {});
    testKeyResultIds = [];
  }
  if (testKRIds.length > 0) {
    await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
    testKRIds = [];
  }
});

// ============================================================
// scoreKRs - Initiative bonus
// ============================================================

describe('scoreKRs - initiative bonus', () => {
  it('should give +15 bonus to KR with active initiative but no queued task', () => {
    const krWithInitiative = { id: 'kr-1', priority: 'P1', progress: 50 };
    const krWithoutInitiative = { id: 'kr-2', priority: 'P1', progress: 50 };

    const state = {
      keyResults: [krWithInitiative, krWithoutInitiative],
      activeTasks: [], // no queued tasks
      focus: null,
      initiativeKRIds: new Set(['kr-1']) // kr-1 has active initiative
    };

    const scored = scoreKRs(state);
    const score1 = scored.find(s => s.kr.id === 'kr-1').score;
    const score2 = scored.find(s => s.kr.id === 'kr-2').score;

    // kr-1 should have +15 bonus over kr-2
    expect(score1 - score2).toBe(15);
    // kr-1 should be ranked first
    expect(scored[0].kr.id).toBe('kr-1');
  });

  it('should set hasInitiativesNeedingPlanning=true for KR with initiative but no queued task', () => {
    const state = {
      keyResults: [
        { id: 'kr-init', priority: 'P1', progress: 0 },
        { id: 'kr-no-init', priority: 'P1', progress: 0 }
      ],
      activeTasks: [],
      focus: null,
      initiativeKRIds: new Set(['kr-init'])
    };

    const scored = scoreKRs(state);
    const initEntry = scored.find(s => s.kr.id === 'kr-init');
    const noInitEntry = scored.find(s => s.kr.id === 'kr-no-init');

    expect(initEntry.hasInitiativesNeedingPlanning).toBe(true);
    expect(noInitEntry.hasInitiativesNeedingPlanning).toBe(false);
  });

  it('should NOT give initiative bonus to KR that already has queued tasks', () => {
    const kr = { id: 'kr-1', priority: 'P1', progress: 50 };

    const stateWithQueued = {
      keyResults: [kr],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-1', project_id: 'proj-1' }
      ],
      focus: null,
      initiativeKRIds: new Set(['kr-1']) // kr-1 has initiative
    };

    const stateWithoutQueued = {
      keyResults: [{ ...kr }],
      activeTasks: [],
      focus: null,
      initiativeKRIds: new Set() // no initiative
    };

    const scoredWithQueued = scoreKRs(stateWithQueued);
    const scoredWithoutQueued = scoreKRs(stateWithoutQueued);

    const scoreWithQueued = scoredWithQueued[0].score;
    const scoreWithoutQueued = scoredWithoutQueued[0].score;

    // When has queued task: gets +15 from queuedByGoal, NOT from initiative bonus
    // When no queued task and no initiative: gets +0
    // Both cases should give same +15 boost (not double-counted)
    expect(scoreWithQueued).toBe(scoreWithoutQueued + 15);
  });

  it('should work correctly when initiativeKRIds is not provided (backward compat)', () => {
    const state = {
      keyResults: [
        { id: 'kr-1', priority: 'P1', progress: 0 }
      ],
      activeTasks: [],
      focus: null
      // no initiativeKRIds field
    };

    // Should not throw
    const scored = scoreKRs(state);
    expect(scored).toHaveLength(1);
    expect(scored[0].kr.id).toBe('kr-1');
  });

  it('should rank KR with initiative higher than same-priority KR without initiative', () => {
    const state = {
      keyResults: [
        { id: 'kr-no-init', priority: 'P1', progress: 0 },
        { id: 'kr-has-init', priority: 'P1', progress: 0 }
      ],
      activeTasks: [],
      focus: null,
      initiativeKRIds: new Set(['kr-has-init'])
    };

    const scored = scoreKRs(state);
    // kr-has-init should rank first
    expect(scored[0].kr.id).toBe('kr-has-init');
    // Score difference should be exactly 15
    const scoreHasInit = scored.find(s => s.kr.id === 'kr-has-init').score;
    const scoreNoInit = scored.find(s => s.kr.id === 'kr-no-init').score;
    expect(scoreHasInit - scoreNoInit).toBe(15);
  });

  it('should not apply initiative bonus if KR has both queued task AND is in initiativeKRIds', () => {
    // initiativeKRIds is built from DB query that already excludes KRs with queued tasks
    // But just in case both conditions are true, initiative bonus should NOT stack with queued bonus
    const state = {
      keyResults: [
        { id: 'kr-both', priority: 'P1', progress: 0 },
        { id: 'kr-init-only', priority: 'P1', progress: 0 },
        { id: 'kr-queue-only', priority: 'P1', progress: 0 }
      ],
      activeTasks: [
        { id: 't-1', status: 'queued', goal_id: 'kr-both', project_id: 'proj-1' },
        { id: 't-2', status: 'queued', goal_id: 'kr-queue-only', project_id: 'proj-2' }
      ],
      focus: null,
      initiativeKRIds: new Set(['kr-both', 'kr-init-only'])
    };

    const scored = scoreKRs(state);
    const scoreBoth = scored.find(s => s.kr.id === 'kr-both').score;
    const scoreInitOnly = scored.find(s => s.kr.id === 'kr-init-only').score;
    const scoreQueueOnly = scored.find(s => s.kr.id === 'kr-queue-only').score;

    // kr-both: has queued task → +15 (from queuedByGoal), but NOT initiative bonus (has queued task)
    // kr-init-only: no queued task + in initiativeKRIds → +15 (from initiative bonus)
    // kr-queue-only: has queued task → +15 (from queuedByGoal)
    expect(scoreBoth).toBe(scoreQueueOnly); // both have queued task, same +15
    expect(scoreInitOnly).toBe(scoreQueueOnly); // initiative bonus equals queued bonus
  });
});

// ============================================================
// selectTargetProject - 优先选择有 initiative 但无 queued task 的 project
// ============================================================

describe('selectTargetProject - initiative priority', () => {
  it('should prefer project with active initiative when no queued tasks exist', async () => {
    // Create a KR in key_results (new table, required for okr_projects.kr_id FK)
    const krResult = await pool.query(
      "INSERT INTO key_results (title, status) VALUES ('Test KR for select', 'in_progress') RETURNING *"
    );
    const kr = krResult.rows[0];
    testKeyResultIds.push(kr.id);

    // Create a parent project in okr_projects with kr_id set (new schema)
    const projWithInitResult = await pool.query(
      "INSERT INTO okr_projects (title, status, kr_id) VALUES ('proj-with-initiative', 'active', $1) RETURNING id",
      [kr.id]
    );
    testOkrProjectIds.push(projWithInitResult.rows[0].id);

    // Initiative exists only in state (selectTargetProject checks state.projects for initiatives)
    const state = {
      projects: [
        { id: projWithInitResult.rows[0].id, name: 'proj-with-initiative', status: 'active', type: 'project', parent_id: null },
        { id: 'test-initiative-' + kr.id, name: 'Test Initiative', status: 'active', type: 'initiative', parent_id: projWithInitResult.rows[0].id }
      ],
      activeTasks: [] // no queued tasks
    };

    const selected = await selectTargetProject(kr, state);

    // Should select the project with active initiative
    expect(selected).not.toBeNull();
    expect(selected.id).toBe(projWithInitResult.rows[0].id);
  });

  it('should prefer project with queued tasks over project with only initiative', async () => {
    // Create a KR in key_results (new table, required for okr_projects.kr_id FK)
    const krResult = await pool.query(
      "INSERT INTO key_results (title, status) VALUES ('KR for project comparison', 'in_progress') RETURNING *"
    );
    const kr = krResult.rows[0];
    testKeyResultIds.push(kr.id);

    // Project 1 in okr_projects: linked to KR (will have queued task in state)
    const proj1Result = await pool.query(
      "INSERT INTO okr_projects (title, status, kr_id) VALUES ('proj-with-task', 'active', $1) RETURNING id",
      [kr.id]
    );
    testOkrProjectIds.push(proj1Result.rows[0].id);

    // Project 2 in okr_projects: linked to KR (will have initiative in state, no tasks)
    const proj2Result = await pool.query(
      "INSERT INTO okr_projects (title, status, kr_id) VALUES ('proj-with-initiative-only', 'active', $1) RETURNING id",
      [kr.id]
    );
    testOkrProjectIds.push(proj2Result.rows[0].id);

    // Initiative exists only in state (not in DB)
    const state = {
      projects: [
        { id: proj1Result.rows[0].id, name: 'proj-with-task', status: 'active', type: 'project', parent_id: null },
        { id: proj2Result.rows[0].id, name: 'proj-with-initiative-only', status: 'active', type: 'project', parent_id: null },
        { id: 'test-init-' + proj2Result.rows[0].id, name: 'Init Under Proj2', status: 'active', type: 'initiative', parent_id: proj2Result.rows[0].id }
      ],
      activeTasks: [
        { id: 'task-1', status: 'queued', project_id: proj1Result.rows[0].id, goal_id: kr.id }
      ]
    };

    const selected = await selectTargetProject(kr, state);

    // Project with queued task should be preferred (score 50) over project with initiative only (score 30)
    expect(selected).not.toBeNull();
    expect(selected.id).toBe(proj1Result.rows[0].id);
  });
});

// ============================================================
// generateArchitectureDesignTask - 自动生成 architecture_design 任务
// ============================================================

describe('generateArchitectureDesignTask - auto task generation', () => {
  it('should generate architecture_design task for project with active initiative and no tasks', async () => {
    // Create a KR (in goals table for goal_id FK on tasks)
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR for initiative plan', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create an okr_project (new table) — kr_id is nullable, leave null for test isolation
    const okrProjResult = await pool.query(
      "INSERT INTO okr_projects (title, status) VALUES ('parent-okr-project-for-init', 'active') RETURNING *"
    );
    const project = okrProjResult.rows[0];
    testOkrProjectIds.push(project.id);

    // Create an okr_scope under the okr_project
    const scopeResult = await pool.query(
      "INSERT INTO okr_scopes (title, status, project_id) VALUES ('Scope For Init', 'active', $1) RETURNING *",
      [project.id]
    );
    testOkrScopeIds.push(scopeResult.rows[0].id);

    // Create an okr_initiative under the scope (no tasks)
    const initResult = await pool.query(
      "INSERT INTO okr_initiatives (title, status, scope_id) VALUES ('Initiative To Plan', 'active', $1) RETURNING *",
      [scopeResult.rows[0].id]
    );
    testOkrInitiativeIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    expect(task.status).toBe('queued');
    expect(task.priority).toBe(kr.priority);
    expect(task.okr_initiative_id).toBe(initResult.rows[0].id); // task linked to initiative
    expect(task.goal_id).toBe(kr.id);
    expect(task.title).toContain('Initiative To Plan');
    expect(task.payload).toBeDefined();

    // description should contain Initiative ID and KR ID
    expect(task.description).toContain(initResult.rows[0].id);
    expect(task.description).toContain(kr.id);

    // payload should contain kr_id and mode: 'design' (Mode 2)
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.kr_id).toBe(kr.id);
    expect(payload.initiative_id).toBe(initResult.rows[0].id);
    expect(payload.mode).toBe('design'); // planner → architecture_design 必须携带 mode=design

    // Track for cleanup (task cleanup handled by testOkrInitiativeIds afterEach)
    testTaskIds.push(task.id);
  });

  it('should return null when no active initiative exists under project (no task generated)', async () => {
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR no initiative', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create an okr_project with NO initiatives
    const okrProjResult = await pool.query(
      "INSERT INTO okr_projects (title, status) VALUES ('okr-project-no-init', 'active') RETURNING *"
    );
    const project = okrProjResult.rows[0];
    testOkrProjectIds.push(project.id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).toBeNull();
  });

  it('should not create duplicate architecture_design task if one already exists', async () => {
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR dedup test', 'area_okr', 'P0', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create okr_project → scope → initiative
    const okrProjResult = await pool.query(
      "INSERT INTO okr_projects (title, status) VALUES ('okr-proj-for-dedup', 'active') RETURNING *"
    );
    const project = okrProjResult.rows[0];
    testOkrProjectIds.push(project.id);

    const scopeResult = await pool.query(
      "INSERT INTO okr_scopes (title, status, project_id) VALUES ('Scope Dedup', 'active', $1) RETURNING *",
      [project.id]
    );
    testOkrScopeIds.push(scopeResult.rows[0].id);

    const initResult = await pool.query(
      "INSERT INTO okr_initiatives (title, status, scope_id) VALUES ('Dedup Initiative', 'active', $1) RETURNING *",
      [scopeResult.rows[0].id]
    );
    testOkrInitiativeIds.push(initResult.rows[0].id);

    // First call - should create task
    const task1 = await generateArchitectureDesignTask(kr, project);
    expect(task1).not.toBeNull();
    testTaskIds.push(task1.id);

    // Second call - should NOT create duplicate (task already exists)
    const task2 = await generateArchitectureDesignTask(kr, project);
    expect(task2).toBeNull();
  });

  it('should inherit KR priority for the generated task', async () => {
    // Create a P0 KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('P0 KR priority test', 'area_okr', 'P0', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create okr_project → scope → initiative
    const okrProjResult = await pool.query(
      "INSERT INTO okr_projects (title, status) VALUES ('okr-proj-priority-test', 'active') RETURNING *"
    );
    const project = okrProjResult.rows[0];
    testOkrProjectIds.push(project.id);

    const scopeResult = await pool.query(
      "INSERT INTO okr_scopes (title, status, project_id) VALUES ('Scope Priority', 'active', $1) RETURNING *",
      [project.id]
    );
    testOkrScopeIds.push(scopeResult.rows[0].id);

    const initResult = await pool.query(
      "INSERT INTO okr_initiatives (title, status, scope_id) VALUES ('P0 Initiative', 'active', $1) RETURNING *",
      [scopeResult.rows[0].id]
    );
    testOkrInitiativeIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.priority).toBe('P0'); // Inherits KR priority
    testTaskIds.push(task.id);
  });
});
