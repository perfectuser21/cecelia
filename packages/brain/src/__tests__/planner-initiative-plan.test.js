/**
 * Planner Initiative Plan Tests
 * Tests for the enhanced Planner that detects "KR with active Initiative but no Task"
 * and auto-generates architecture_design tasks.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { scoreKRs, selectTargetProject, generateArchitectureDesignTask, resolveInitiativeDomain } from '../planner.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

// Track test data for cleanup
let testKRIds = [];
let testProjectIds = [];
let testTaskIds = [];
let testLinks = [];

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
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('Test KR for select', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create a parent project WITH an initiative (no tasks)
    const projWithInitResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-with-initiative', '/tmp/proj-with-init', 'active') RETURNING id"
    );
    testProjectIds.push(projWithInitResult.rows[0].id);

    // Link project to KR
    await pool.query(
      'INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [projWithInitResult.rows[0].id, kr.id]
    );
    testLinks.push({ project_id: projWithInitResult.rows[0].id, kr_id: kr.id });

    // Create initiative under the project (no queued tasks)
    const initiativeResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Test Initiative', 'initiative', $1, 'active') RETURNING id",
      [projWithInitResult.rows[0].id]
    );
    testProjectIds.push(initiativeResult.rows[0].id);

    const state = {
      projects: [
        { id: projWithInitResult.rows[0].id, name: 'proj-with-initiative', status: 'active', type: 'project', parent_id: null },
        { id: initiativeResult.rows[0].id, name: 'Test Initiative', status: 'active', type: 'initiative', parent_id: projWithInitResult.rows[0].id }
      ],
      activeTasks: [] // no queued tasks
    };

    const selected = await selectTargetProject(kr, state);

    // Should select the project with active initiative
    expect(selected).not.toBeNull();
    expect(selected.id).toBe(projWithInitResult.rows[0].id);
  });

  it('should prefer project with queued tasks over project with only initiative', async () => {
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR for project comparison', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Project 1: has queued task, no initiative
    const proj1Result = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-with-task', '/tmp/proj1', 'active') RETURNING id"
    );
    testProjectIds.push(proj1Result.rows[0].id);
    await pool.query('INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [proj1Result.rows[0].id, kr.id]);
    testLinks.push({ project_id: proj1Result.rows[0].id, kr_id: kr.id });

    // Project 2: has initiative but no queued task
    const proj2Result = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-with-initiative-only', '/tmp/proj2', 'active') RETURNING id"
    );
    testProjectIds.push(proj2Result.rows[0].id);
    await pool.query('INSERT INTO project_kr_links (project_id, kr_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [proj2Result.rows[0].id, kr.id]);
    testLinks.push({ project_id: proj2Result.rows[0].id, kr_id: kr.id });

    // Initiative under project 2 (no tasks)
    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Init Under Proj2', 'initiative', $1, 'active') RETURNING id",
      [proj2Result.rows[0].id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const state = {
      projects: [
        { id: proj1Result.rows[0].id, name: 'proj-with-task', status: 'active', type: 'project', parent_id: null },
        { id: proj2Result.rows[0].id, name: 'proj-with-initiative-only', status: 'active', type: 'project', parent_id: null },
        { id: initResult.rows[0].id, name: 'Init Under Proj2', status: 'active', type: 'initiative', parent_id: proj2Result.rows[0].id }
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
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR for initiative plan', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create a project (parent)
    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('parent-project-for-init', '/tmp/parent', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    // Create an initiative under the project (no tasks)
    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Initiative To Plan', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    expect(task.status).toBe('queued');
    expect(task.priority).toBe(kr.priority);
    expect(task.project_id).toBe(initResult.rows[0].id); // task belongs to initiative
    expect(task.goal_id).toBe(kr.id);
    expect(task.title).toContain('Initiative To Plan');
    expect(task.payload).toBeDefined();

    // description should contain Initiative ID and KR ID
    expect(task.description).toContain(initResult.rows[0].id);
    expect(task.description).toContain(kr.id);

    // payload should contain kr_id
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.kr_id).toBe(kr.id);
    expect(payload.initiative_id).toBe(initResult.rows[0].id);

    // Track for cleanup
    testTaskIds.push(task.id);
  });

  it('should return null when no active initiative exists under project (no task generated)', async () => {
    // Create a KR
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR no initiative', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    // Create a project with NO initiatives
    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('project-no-init', '/tmp/no-init', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

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

    // Create a project
    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-for-dedup', '/tmp/dedup', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    // Create an initiative
    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Dedup Initiative', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

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

    // Create a project
    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-priority-test', '/tmp/priority', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    // Create an initiative
    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('P0 Initiative', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.priority).toBe('P0'); // Inherits KR priority
    testTaskIds.push(task.id);
  });
});

// ============================================================
// resolveInitiativeDomain - domain 继承链
// ============================================================

describe('resolveInitiativeDomain - domain inheritance', () => {
  it('should return initiative.domain when set', () => {
    const initiative = { domain: 'product' };
    const project = { domain: 'coding' };
    const kr = { domain: 'growth' };
    expect(resolveInitiativeDomain(initiative, project, kr)).toBe('product');
  });

  it('should fallback to parentProject.domain when initiative.domain is null', () => {
    const initiative = { domain: null };
    const project = { domain: 'growth' };
    const kr = { domain: 'quality' };
    expect(resolveInitiativeDomain(initiative, project, kr)).toBe('growth');
  });

  it('should fallback to kr.domain when initiative and project domain are null', () => {
    const initiative = { domain: null };
    const project = { domain: null };
    const kr = { domain: 'quality' };
    expect(resolveInitiativeDomain(initiative, project, kr)).toBe('quality');
  });

  it('should return null when all domain fields are null', () => {
    const initiative = { domain: null };
    const project = { domain: null };
    const kr = { domain: null };
    expect(resolveInitiativeDomain(initiative, project, kr)).toBeNull();
  });

  it('should return null when domain fields are empty strings', () => {
    const initiative = { domain: '' };
    const project = { domain: '' };
    const kr = { domain: '' };
    expect(resolveInitiativeDomain(initiative, project, kr)).toBeNull();
  });
});

// ============================================================
// generateArchitectureDesignTask - domain routing
// ============================================================

describe('generateArchitectureDesignTask - domain routing', () => {
  it('should generate architecture_design task when domain is null (fallback)', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR domain null', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-domain-null', '/tmp/domain-null', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Init No Domain', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    testTaskIds.push(task.id);
  });

  it('should generate architecture_design task when domain is coding', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress, domain) VALUES ('KR domain coding', 'area_okr', 'P1', 'in_progress', 0, 'coding') RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status, domain) VALUES ('proj-domain-coding', '/tmp/domain-coding', 'active', 'coding') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Init Coding Domain', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    testTaskIds.push(task.id);
  });

  it('should generate initiative_plan task when domain is product', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR domain product', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-domain-product', '/tmp/domain-product', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Init Product Domain', 'initiative', $1, 'active', 'product') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.domain).toBe('product');
    testTaskIds.push(task.id);
  });

  it('should generate initiative_plan task when domain inherited from parent project (growth)', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR domain growth inherited', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status, domain) VALUES ('proj-domain-growth', '/tmp/domain-growth', 'active', 'growth') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status) VALUES ('Init Inherits Growth', 'initiative', $1, 'active') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.domain).toBe('growth');
    testTaskIds.push(task.id);
  });

  it('should not create duplicate when initiative_plan task already exists', async () => {
    const krResult = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('KR dedup initiative_plan', 'area_okr', 'P1', 'in_progress', 0) RETURNING *"
    );
    const kr = krResult.rows[0];
    testKRIds.push(kr.id);

    const projResult = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ('proj-dedup-initplan', '/tmp/dedup-initplan', 'active') RETURNING *"
    );
    const project = projResult.rows[0];
    testProjectIds.push(project.id);

    const initResult = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ('Dedup Init Plan', 'initiative', $1, 'active', 'product') RETURNING *",
      [project.id]
    );
    testProjectIds.push(initResult.rows[0].id);

    // First call
    const task1 = await generateArchitectureDesignTask(kr, project);
    expect(task1).not.toBeNull();
    expect(task1.task_type).toBe('initiative_plan');
    testTaskIds.push(task1.id);

    // Second call should be null (dedup)
    const task2 = await generateArchitectureDesignTask(kr, project);
    expect(task2).toBeNull();
  });
});
