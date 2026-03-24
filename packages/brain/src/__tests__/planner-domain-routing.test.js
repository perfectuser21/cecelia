/**
 * Planner Domain Routing Tests
 *
 * Tests for generateArchitectureDesignTask() domain-based routing:
 * - coding domain → architecture_design task → /architect
 * - non-coding domain → initiative_plan task + skill_override from role-registry
 * - domain inheritance chain: Initiative → Project → KR → default 'coding'
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { generateArchitectureDesignTask } from '../planner.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

let testKRIds = [];
let testProjectIds = [];
let testTaskIds = [];

beforeAll(async () => {
  await pool.query('SELECT 1');
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  if (testTaskIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE id = ANY($1)', [testTaskIds]).catch(() => {});
    testTaskIds = [];
  }
  if (testProjectIds.length > 0) {
    await pool.query('DELETE FROM tasks WHERE project_id = ANY($1)', [testProjectIds]).catch(() => {});
    // 显式清理新 OKR 表（不依赖触发器级联，触发器用 EXCEPTION WHEN OTHERS 静默失败）
    await pool.query('DELETE FROM okr_initiatives WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    await pool.query('DELETE FROM okr_scopes WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    await pool.query('DELETE FROM okr_projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    testProjectIds = [];
  }
  if (testKRIds.length > 0) {
    // 显式清理新 OKR 表（不依赖触发器级联）
    await pool.query('DELETE FROM key_results WHERE id = ANY($1)', [testKRIds]).catch(() => {});
    await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
    testKRIds = [];
  }
});

// Helper: create KR
async function createKR({ title = 'Test KR', priority = 'P1', domain = null } = {}) {
  const result = await pool.query(
    `INSERT INTO goals (title, type, priority, status, progress, domain)
     VALUES ($1, 'area_kr', $2, 'in_progress', 0, $3) RETURNING *`,
    [title, priority, domain]
  );
  const kr = result.rows[0];
  testKRIds.push(kr.id);
  return kr;
}

// Helper: create parent project
async function createProject({ name = 'Test Project', domain = null } = {}) {
  const result = await pool.query(
    `INSERT INTO projects (name, repo_path, status, domain)
     VALUES ($1, '/tmp/test', 'active', $2) RETURNING *`,
    [name, domain]
  );
  const proj = result.rows[0];
  testProjectIds.push(proj.id);
  return proj;
}

// Helper: create initiative
async function createInitiative({ name = 'Test Initiative', parentId, domain = null } = {}) {
  const result = await pool.query(
    `INSERT INTO projects (name, type, parent_id, status, domain)
     VALUES ($1, 'initiative', $2, 'active', $3) RETURNING *`,
    [name, parentId, domain]
  );
  const init = result.rows[0];
  testProjectIds.push(init.id);
  return init;
}

// ============================================================
// DoD-1: coding domain → architecture_design
// ============================================================

describe('coding domain → architecture_design task', () => {
  it('should generate architecture_design task for initiative with explicit coding domain', async () => {
    const kr = await createKR({ title: 'KR coding domain' });
    const project = await createProject({ name: 'proj-coding' });
    await createInitiative({ name: 'Coding Initiative', parentId: project.id, domain: 'coding' });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    expect(task.status).toBe('queued');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBeUndefined();

    testTaskIds.push(task.id);
  });

  it('should generate architecture_design task when no domain set (default coding)', async () => {
    const kr = await createKR({ title: 'KR no domain' });
    const project = await createProject({ name: 'proj-no-domain' });
    await createInitiative({ name: 'No Domain Initiative', parentId: project.id });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');

    testTaskIds.push(task.id);
  });
});

// ============================================================
// DoD-2: growth domain → initiative_plan + /research
// ============================================================

describe('growth domain → initiative_plan + skill_override=/research', () => {
  it('should generate initiative_plan task with skill_override=/research for growth domain', async () => {
    const kr = await createKR({ title: 'KR growth domain' });
    const project = await createProject({ name: 'proj-growth' });
    await createInitiative({ name: 'Growth Initiative', parentId: project.id, domain: 'growth' });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');
    expect(task.status).toBe('queued');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBe('/content-creator');
    expect(payload.domain).toBe('growth');
    expect(payload.initiative_id).toBeDefined();
    expect(payload.kr_id).toBe(kr.id);

    testTaskIds.push(task.id);
  });

  it('should set task title to include domain and initiative name', async () => {
    const kr = await createKR({ title: 'KR growth title test' });
    const project = await createProject({ name: 'proj-growth-title' });
    await createInitiative({ name: 'Growth Title Initiative', parentId: project.id, domain: 'growth' });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.title).toContain('growth');
    expect(task.title).toContain('Growth Title Initiative');

    testTaskIds.push(task.id);
  });
});

// ============================================================
// DoD-3: product domain → initiative_plan + /plan
// ============================================================

describe('product domain → initiative_plan + skill_override=/plan', () => {
  it('should generate initiative_plan task with skill_override=/plan for product domain', async () => {
    const kr = await createKR({ title: 'KR product domain' });
    const project = await createProject({ name: 'proj-product' });
    await createInitiative({ name: 'Product Initiative', parentId: project.id, domain: 'product' });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBe('/plan');
    expect(payload.domain).toBe('product');

    testTaskIds.push(task.id);
  });
});

// ============================================================
// DoD-4: domain inheritance chain
// ============================================================

describe('domain inheritance chain: Initiative → Project → KR → default coding', () => {
  it('should inherit domain from parent project when initiative.domain is null', async () => {
    const kr = await createKR({ title: 'KR for project domain inherit' });
    const project = await createProject({ name: 'proj-growth-domain', domain: 'growth' });
    // Initiative has no domain
    await createInitiative({ name: 'Initiative No Domain', parentId: project.id, domain: null });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBe('/content-creator');
    expect(payload.domain).toBe('growth');

    testTaskIds.push(task.id);
  });

  it('should inherit domain from KR when initiative and project domains are null', async () => {
    const kr = await createKR({ title: 'KR with growth domain', domain: 'growth' });
    const project = await createProject({ name: 'proj-no-domain-kr-test', domain: null });
    await createInitiative({ name: 'Initiative KR Domain', parentId: project.id, domain: null });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBe('/content-creator');

    testTaskIds.push(task.id);
  });

  it('should default to coding (architecture_design) when all domains are null', async () => {
    const kr = await createKR({ title: 'KR all null domains', domain: null });
    const project = await createProject({ name: 'proj-all-null', domain: null });
    await createInitiative({ name: 'Initiative All Null', parentId: project.id, domain: null });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');

    testTaskIds.push(task.id);
  });

  it('should prefer initiative.domain over project.domain', async () => {
    const kr = await createKR({ title: 'KR domain override' });
    // Project has coding domain, but initiative overrides to growth
    const project = await createProject({ name: 'proj-coding-domain', domain: 'coding' });
    await createInitiative({ name: 'Initiative Override Domain', parentId: project.id, domain: 'growth' });

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');

    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    expect(payload.skill_override).toBe('/content-creator');

    testTaskIds.push(task.id);
  });
});

// ============================================================
// DoD-5: dedup check per domain/task_type
// ============================================================

describe('dedup check per task_type', () => {
  it('should not create duplicate initiative_plan task for same growth initiative', async () => {
    const kr = await createKR({ title: 'KR growth dedup' });
    const project = await createProject({ name: 'proj-growth-dedup' });
    await createInitiative({ name: 'Growth Dedup Initiative', parentId: project.id, domain: 'growth' });

    const task1 = await generateArchitectureDesignTask(kr, project);
    expect(task1).not.toBeNull();
    expect(task1.task_type).toBe('initiative_plan');
    testTaskIds.push(task1.id);

    const task2 = await generateArchitectureDesignTask(kr, project);
    expect(task2).toBeNull();
  });

  it('should not create duplicate architecture_design task for same coding initiative', async () => {
    const kr = await createKR({ title: 'KR coding dedup' });
    const project = await createProject({ name: 'proj-coding-dedup' });
    await createInitiative({ name: 'Coding Dedup Initiative', parentId: project.id, domain: 'coding' });

    const task1 = await generateArchitectureDesignTask(kr, project);
    expect(task1).not.toBeNull();
    testTaskIds.push(task1.id);

    const task2 = await generateArchitectureDesignTask(kr, project);
    expect(task2).toBeNull();
  });
});
