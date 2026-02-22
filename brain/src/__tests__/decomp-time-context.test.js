/**
 * Decomposition Checker 时间上下文注入测试
 *
 * DoD 覆盖: D5-D7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock validate-okr-structure.js
vi.mock('../validate-okr-structure.js', () => ({
  validateOkrStructure: vi.fn(async () => ({ ok: true, issues: [] })),
}));

// Mock task-quality-gate.js
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: vi.fn(() => ({ valid: true })),
}));

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn(() => ({
    project: { max: 5 },
    initiative: { max: 9 },
    task: { queuedCap: 27 },
  })),
  isAtCapacity: vi.fn(() => false),
}));

import pool from '../db.js';

// Import the module under test - need individual checks
import { runDecompositionChecks } from '../decomposition-checker.js';

/**
 * 单独测试 Check 5 和 Check 6 的 description 中时间信息注入。
 * 通过 mock pool.query 拦截 INSERT INTO tasks 的参数来验证。
 */
describe('Check 5: Project decomposition 时间上下文', () => {
  let insertedDescription;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedDescription = null;
  });

  it('D5: description 包含 time_budget_days', async () => {
    pool.query = vi.fn(async (sql, params) => {
      // OKR validation counts
      if (sql.includes('schema_version')) return { rows: [{ version: '052' }] };
      // Capacity counts
      if (sql.includes('COUNT') && sql.includes("type = 'project'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes("type = 'initiative'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes('tasks')) return { rows: [{ cnt: '0' }] };
      // Check 1-4: no results
      if (sql.includes("type = 'global_okr'")) return { rows: [] };
      if (sql.includes("type = 'global_kr'")) return { rows: [] };
      if (sql.includes("type = 'area_okr'")) return { rows: [] };
      if (sql.includes("type = 'area_kr'")) return { rows: [] };
      // Check 5: Project with time_budget_days and deadline
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'") && sql.includes('time_budget_days')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test Project', repo_path: '/test',
            time_budget_days: 14, deadline: '2026-03-15',
          }],
        };
      }
      // Dedup check - no existing task
      if (sql.includes('tasks') && sql.includes("payload->>'level'")) return { rows: [] };
      // KR links for project
      if (sql.includes('project_kr_links') && sql.includes('pkl.project_id')) {
        return { rows: [{ id: 'kr-1', title: 'Test KR' }] };
      }
      // Check 6: no initiatives
      if (sql.includes("p.type = 'initiative'")) return { rows: [] };
      // Check 7: no exploratory
      if (sql.includes("payload->>'exploratory'")) return { rows: [] };
      // Validate task description quality gate pass
      if (sql.includes('INSERT INTO tasks')) {
        insertedDescription = params[1]; // description is $2
        return { rows: [{ id: 'task-1' }] };
      }
      return { rows: [] };
    });

    await runDecompositionChecks();

    expect(insertedDescription).not.toBeNull();
    expect(insertedDescription).toContain('时间预算: 14 天');
  });

  it('D6: description 包含 deadline', async () => {
    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('schema_version')) return { rows: [{ version: '052' }] };
      if (sql.includes('COUNT') && sql.includes("type = 'project'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes("type = 'initiative'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes('tasks')) return { rows: [{ cnt: '0' }] };
      if (sql.includes("type = 'global_okr'")) return { rows: [] };
      if (sql.includes("type = 'global_kr'")) return { rows: [] };
      if (sql.includes("type = 'area_okr'")) return { rows: [] };
      if (sql.includes("type = 'area_kr'")) return { rows: [] };
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'") && sql.includes('time_budget_days')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test Project', repo_path: '/test',
            time_budget_days: null, deadline: '2026-03-15',
          }],
        };
      }
      if (sql.includes('tasks') && sql.includes("payload->>'level'")) return { rows: [] };
      if (sql.includes('project_kr_links') && sql.includes('pkl.project_id')) {
        return { rows: [{ id: 'kr-1', title: 'Test KR' }] };
      }
      if (sql.includes("p.type = 'initiative'")) return { rows: [] };
      if (sql.includes("payload->>'exploratory'")) return { rows: [] };
      if (sql.includes('INSERT INTO tasks')) {
        insertedDescription = params[1];
        return { rows: [{ id: 'task-1' }] };
      }
      return { rows: [] };
    });

    await runDecompositionChecks();

    expect(insertedDescription).not.toBeNull();
    expect(insertedDescription).toContain('截止日期: 2026-03-15');
  });
});

describe('Check 6: Initiative decomposition 时间上下文', () => {
  let insertedDescription;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedDescription = null;
  });

  it('D7: description 包含 Project deadline', async () => {
    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('schema_version')) return { rows: [{ version: '052' }] };
      if (sql.includes('COUNT') && sql.includes("type = 'project'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes("type = 'initiative'")) return { rows: [{ cnt: '0' }] };
      if (sql.includes('COUNT') && sql.includes('tasks')) return { rows: [{ cnt: '0' }] };
      if (sql.includes("type = 'global_okr'")) return { rows: [] };
      if (sql.includes("type = 'global_kr'")) return { rows: [] };
      if (sql.includes("type = 'area_okr'")) return { rows: [] };
      if (sql.includes("type = 'area_kr'")) return { rows: [] };
      // Check 5: no projects needing decomp
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'") && sql.includes('time_budget_days')) {
        return { rows: [] };
      }
      // Check 6: initiative with parent deadline
      if (sql.includes("p.type = 'initiative'") && sql.includes('parent_deadline')) {
        return {
          rows: [{
            id: 'init-1', name: 'Test Initiative', parent_id: 'proj-1',
            plan_content: null, parent_name: 'Parent Project', repo_path: '/test',
            parent_deadline: '2026-03-20', parent_time_budget: 14,
            depth: 1,
          }],
        };
      }
      // Dedup check
      if (sql.includes('tasks') && sql.includes("payload->>'level'")) return { rows: [] };
      // KR link for initiative (Layer 1)
      if (sql.includes('project_kr_links') && sql.includes('pkl.project_id')) {
        return { rows: [{ kr_id: 'kr-1' }] };
      }
      // KR saturation check
      if (sql.includes("goal_id = $1") && sql.includes("status IN ('queued'")) {
        return { rows: [{ count: '0' }] };
      }
      // Check 7: no exploratory
      if (sql.includes("payload->>'exploratory'")) return { rows: [] };
      if (sql.includes('INSERT INTO tasks')) {
        insertedDescription = params[1];
        return { rows: [{ id: 'task-1' }] };
      }
      return { rows: [] };
    });

    await runDecompositionChecks();

    expect(insertedDescription).not.toBeNull();
    expect(insertedDescription).toContain('Project 截止日期: 2026-03-20');
    expect(insertedDescription).toContain('Project 时间预算: 14 天');
  });
});
