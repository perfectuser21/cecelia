/**
 * Planner Domain-Aware Routing Tests
 * Tests for resolveTaskTypeByDomain() and domain-aware generateArchitectureDesignTask()
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';
import { resolveTaskTypeByDomain, DOMAIN_TO_TASK_TYPE, generateArchitectureDesignTask } from '../planner.js';

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
    await pool.query('DELETE FROM projects WHERE id = ANY($1)', [testProjectIds]).catch(() => {});
    testProjectIds = [];
  }
  if (testKRIds.length > 0) {
    await pool.query('DELETE FROM goals WHERE id = ANY($1)', [testKRIds]).catch(() => {});
    testKRIds = [];
  }
});

// ============================================================
// resolveTaskTypeByDomain - pure unit tests (no DB)
// ============================================================

describe('resolveTaskTypeByDomain', () => {
  it('null domain → architecture_design (backward compat)', () => {
    expect(resolveTaskTypeByDomain(null)).toBe('architecture_design');
  });

  it('undefined domain → architecture_design (backward compat)', () => {
    expect(resolveTaskTypeByDomain(undefined)).toBe('architecture_design');
  });

  it('empty string domain → architecture_design (backward compat)', () => {
    expect(resolveTaskTypeByDomain('')).toBe('architecture_design');
  });

  it('coding domain → architecture_design', () => {
    expect(resolveTaskTypeByDomain('coding')).toBe('architecture_design');
  });

  it('agent_ops domain → architecture_design', () => {
    expect(resolveTaskTypeByDomain('agent_ops')).toBe('architecture_design');
  });

  it('operations domain → architecture_design', () => {
    expect(resolveTaskTypeByDomain('operations')).toBe('architecture_design');
  });

  it('security domain → architecture_design', () => {
    expect(resolveTaskTypeByDomain('security')).toBe('architecture_design');
  });

  it('quality domain → qa', () => {
    expect(resolveTaskTypeByDomain('quality')).toBe('qa');
  });

  it('product domain → initiative_plan', () => {
    expect(resolveTaskTypeByDomain('product')).toBe('initiative_plan');
  });

  it('research domain → research', () => {
    expect(resolveTaskTypeByDomain('research')).toBe('research');
  });

  it('knowledge domain → knowledge', () => {
    expect(resolveTaskTypeByDomain('knowledge')).toBe('knowledge');
  });

  it('growth domain → dev', () => {
    expect(resolveTaskTypeByDomain('growth')).toBe('dev');
  });

  it('finance domain → null (no auto task)', () => {
    expect(resolveTaskTypeByDomain('finance')).toBeNull();
  });

  it('unknown domain → architecture_design (fallback)', () => {
    expect(resolveTaskTypeByDomain('unknown_xyz')).toBe('architecture_design');
  });

  it('DOMAIN_TO_TASK_TYPE mapping is exported and usable', () => {
    expect(DOMAIN_TO_TASK_TYPE).toBeDefined();
    expect(DOMAIN_TO_TASK_TYPE.coding).toBe('architecture_design');
    expect(DOMAIN_TO_TASK_TYPE.quality).toBe('qa');
    expect(DOMAIN_TO_TASK_TYPE.product).toBe('initiative_plan');
  });
});

// ============================================================
// generateArchitectureDesignTask - domain integration tests
// ============================================================

describe('generateArchitectureDesignTask - domain routing', () => {
  async function createKR(title = 'Test KR') {
    const r = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ($1, 'area_okr', 'P1', 'in_progress', 0) RETURNING *",
      [title]
    );
    testKRIds.push(r.rows[0].id);
    return r.rows[0];
  }

  async function createProject(name, repoPatch = '/tmp/test') {
    const r = await pool.query(
      "INSERT INTO projects (name, repo_path, status) VALUES ($1, $2, 'active') RETURNING *",
      [name, repoPatch]
    );
    testProjectIds.push(r.rows[0].id);
    return r.rows[0];
  }

  async function createInitiative(name, parentId, domain = null) {
    const r = await pool.query(
      "INSERT INTO projects (name, type, parent_id, status, domain) VALUES ($1, 'initiative', $2, 'active', $3) RETURNING *",
      [name, parentId, domain]
    );
    testProjectIds.push(r.rows[0].id);
    return r.rows[0];
  }

  it('domain=null → generates architecture_design task (backward compat)', async () => {
    const kr = await createKR('KR null domain');
    const project = await createProject('proj-null-domain');
    await createInitiative('Initiative null domain', project.id, null);

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    testTaskIds.push(task.id);
  });

  it('domain=coding → generates architecture_design task', async () => {
    const kr = await createKR('KR coding domain');
    const project = await createProject('proj-coding-domain');
    await createInitiative('Initiative coding', project.id, 'coding');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    testTaskIds.push(task.id);
  });

  it('domain=quality → generates qa task', async () => {
    const kr = await createKR('KR quality domain');
    const project = await createProject('proj-quality-domain');
    await createInitiative('Initiative quality', project.id, 'quality');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('qa');
    testTaskIds.push(task.id);
  });

  it('domain=product → generates initiative_plan task', async () => {
    const kr = await createKR('KR product domain');
    const project = await createProject('proj-product-domain');
    await createInitiative('Initiative product', project.id, 'product');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('initiative_plan');
    testTaskIds.push(task.id);
  });

  it('domain=research → generates research task', async () => {
    const kr = await createKR('KR research domain');
    const project = await createProject('proj-research-domain');
    await createInitiative('Initiative research', project.id, 'research');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('research');
    testTaskIds.push(task.id);
  });

  it('domain=knowledge → generates knowledge task', async () => {
    const kr = await createKR('KR knowledge domain');
    const project = await createProject('proj-knowledge-domain');
    await createInitiative('Initiative knowledge', project.id, 'knowledge');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('knowledge');
    testTaskIds.push(task.id);
  });

  it('domain=growth → generates dev task', async () => {
    const kr = await createKR('KR growth domain');
    const project = await createProject('proj-growth-domain');
    await createInitiative('Initiative growth', project.id, 'growth');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('dev');
    testTaskIds.push(task.id);
  });

  it('domain=finance → returns null (no auto task)', async () => {
    const kr = await createKR('KR finance domain');
    const project = await createProject('proj-finance-domain');
    await createInitiative('Initiative finance', project.id, 'finance');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).toBeNull();
  });

  it('domain=unknown → falls back to architecture_design', async () => {
    const kr = await createKR('KR unknown domain');
    const project = await createProject('proj-unknown-domain');
    await createInitiative('Initiative unknown', project.id, 'some_new_domain');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.task_type).toBe('architecture_design');
    testTaskIds.push(task.id);
  });

  it('dedup check uses resolved task_type (quality domain)', async () => {
    const kr = await createKR('KR dedup quality');
    const project = await createProject('proj-dedup-quality');
    await createInitiative('Initiative dedup quality', project.id, 'quality');

    // First call creates qa task
    const task1 = await generateArchitectureDesignTask(kr, project);
    expect(task1).not.toBeNull();
    expect(task1.task_type).toBe('qa');
    testTaskIds.push(task1.id);

    // Second call should return null (dedup)
    const task2 = await generateArchitectureDesignTask(kr, project);
    expect(task2).toBeNull();
  });

  it('task inherits KR priority regardless of domain', async () => {
    const r = await pool.query(
      "INSERT INTO goals (title, type, priority, status, progress) VALUES ('P0 KR product', 'area_okr', 'P0', 'in_progress', 0) RETURNING *"
    );
    const kr = r.rows[0];
    testKRIds.push(kr.id);

    const project = await createProject('proj-priority-product');
    await createInitiative('Initiative P0 product', project.id, 'product');

    const task = await generateArchitectureDesignTask(kr, project);

    expect(task).not.toBeNull();
    expect(task.priority).toBe('P0');
    expect(task.task_type).toBe('initiative_plan');
    testTaskIds.push(task.id);
  });
});
