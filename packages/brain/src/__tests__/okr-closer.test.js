/**
 * OKR Closer 单元测试
 *
 * 覆盖三个函数：
 *   - checkOkrInitiativeCompletion
 *   - checkOkrScopeCompletion
 *   - checkOkrProjectCompletion
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  checkOkrInitiativeCompletion,
  checkOkrScopeCompletion,
  checkOkrProjectCompletion,
} from '../okr-closer.js';

// ════════════════════════════════════════════════════════════════════════════
// Mock Pool 工厂
// ════════════════════════════════════════════════════════════════════════════

/**
 * 构造 checkOkrInitiativeCompletion 用 mock pool。
 */
function makeInitiativePool(opts = {}) {
  const {
    initiatives = [],
    taskStats = {},     // initiativeId → { total, queued, in_progress, quarantine }
    remaining = 0,      // 同 scope 下剩余未完成 initiative 数量
    existingPlan = [],  // 已存在的 scope_plan 任务
    scopeTitle = 'Scope A',
  } = opts;

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查 active/in_progress initiatives
      if (s.includes('FROM okr_initiatives') && s.includes("status NOT IN ('completed', 'cancelled')") && !s.includes('scope_id = $1') && !s.includes('COUNT(*)')) {
        return { rows: initiatives };
      }

      // 查 tasks 统计
      if (s.includes('FROM tasks') && s.includes('okr_initiative_id = $1')) {
        const id = params?.[0];
        const stats = taskStats[id] || { total: '0', queued: '0', in_progress: '0', quarantine: '0' };
        return {
          rows: [{
            total: String(stats.total ?? 0),
            queued: String(stats.queued ?? 0),
            in_progress: String(stats.in_progress ?? 0),
            quarantine: String(stats.quarantine ?? 0),
          }],
        };
      }

      // UPDATE okr_initiatives SET status = 'completed'
      if (s.includes('UPDATE okr_initiatives') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT cecelia_events
      if (s.includes('INSERT INTO cecelia_events')) {
        return { rows: [] };
      }

      // 查剩余未完成 initiatives（remaining check）
      if (s.includes('COUNT(*)') && s.includes('FROM okr_initiatives') && s.includes('scope_id = $1')) {
        return { rows: [{ cnt: String(remaining) }] };
      }

      // 查已存在的 scope_plan 任务
      if (s.includes("task_type = 'okr_scope_plan'") && s.includes("status IN ('queued', 'in_progress')")) {
        return { rows: existingPlan };
      }

      // 查 scope title
      if (s.includes('FROM okr_scopes WHERE id = $1')) {
        return { rows: [{ title: scopeTitle }] };
      }

      // INSERT tasks（scope_plan）
      if (s.includes('INSERT INTO tasks') && s.includes('okr_scope_plan')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

/**
 * 构造 checkOkrScopeCompletion 用 mock pool。
 */
function makeScopePool(opts = {}) {
  const {
    scopes = [],       // 满足完成条件的 scopes
    existingPlan = [], // 已存在的 project_plan 任务
    projectTitle = 'Project A',
  } = opts;

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查满足条件的 scopes（EXISTS / NOT EXISTS 在 SQL 中处理）
      if (s.includes('FROM okr_scopes s') && s.includes("status NOT IN ('completed', 'cancelled')")) {
        return { rows: scopes };
      }

      // UPDATE okr_scopes SET status = 'completed'
      if (s.includes('UPDATE okr_scopes') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT cecelia_events
      if (s.includes('INSERT INTO cecelia_events')) {
        return { rows: [] };
      }

      // 查已存在的 project_plan 任务
      if (s.includes("task_type = 'okr_project_plan'") && s.includes("status IN ('queued', 'in_progress')")) {
        return { rows: existingPlan };
      }

      // 查 project title
      if (s.includes('FROM okr_projects WHERE id = $1')) {
        return { rows: [{ title: projectTitle }] };
      }

      // INSERT tasks（project_plan）
      if (s.includes('INSERT INTO tasks') && s.includes('okr_project_plan')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

/**
 * 构造 checkOkrProjectCompletion 用 mock pool。
 */
function makeProjectPool(opts = {}) {
  const {
    projects = [], // 满足完成条件的 projects
  } = opts;

  return {
    query: vi.fn().mockImplementation(async (sql) => {
      const s = sql.trim();

      // 查满足条件的 projects
      if (s.includes('FROM okr_projects p') && s.includes("status NOT IN ('completed', 'cancelled')")) {
        return { rows: projects };
      }

      // UPDATE okr_projects SET status = 'completed'
      if (s.includes('UPDATE okr_projects') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT cecelia_events
      if (s.includes('INSERT INTO cecelia_events')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// checkOkrInitiativeCompletion
// ════════════════════════════════════════════════════════════════════════════

describe('checkOkrInitiativeCompletion', () => {
  it('无活跃 initiative 时返回 closedCount=0', async () => {
    const pool = makeInitiativePool({ initiatives: [] });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(result.closed).toEqual([]);
  });

  it('有活跃任务时不关闭 initiative', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 3, queued: 1, in_progress: 0, quarantine: 0 } },
    });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('有 in_progress 任务时不关闭', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 3, queued: 0, in_progress: 1, quarantine: 0 } },
    });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('有隔离任务时不关闭', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 3, queued: 0, in_progress: 0, quarantine: 1 } },
    });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('无任务时不关闭（total=0）', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 0, queued: 0, in_progress: 0, quarantine: 0 } },
    });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(0);
  });

  it('所有任务完成时关闭 initiative', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 3, queued: 0, in_progress: 0, quarantine: 0 } },
      remaining: 0,
    });
    const result = await checkOkrInitiativeCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toMatchObject({ id: 'init-1', title: '做功能A' });
  });

  it('scope 下还有未完成 initiative 时创建 okr_scope_plan 任务', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 2, queued: 0, in_progress: 0, quarantine: 0 } },
      remaining: 1,
      existingPlan: [],
      scopeTitle: 'Scope Beta',
    });
    await checkOkrInitiativeCompletion(pool);
    const calls = pool.query.mock.calls.map(c => c[0]);
    const hasScopePlanInsert = calls.some(sql => sql.includes('okr_scope_plan'));
    expect(hasScopePlanInsert).toBe(true);
  });

  it('已存在 okr_scope_plan 任务时不重复创建', async () => {
    const pool = makeInitiativePool({
      initiatives: [{ id: 'init-1', title: '做功能A', scope_id: 'scope-1' }],
      taskStats: { 'init-1': { total: 2, queued: 0, in_progress: 0, quarantine: 0 } },
      remaining: 1,
      existingPlan: [{ id: 'task-existing' }],
    });
    await checkOkrInitiativeCompletion(pool);
    const insertCalls = pool.query.mock.calls.filter(c =>
      c[0].includes('INSERT INTO tasks') && c[0].includes('okr_scope_plan')
    );
    expect(insertCalls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkOkrScopeCompletion
// ════════════════════════════════════════════════════════════════════════════

describe('checkOkrScopeCompletion', () => {
  it('无满足条件的 scope 时返回 closedCount=0', async () => {
    const pool = makeScopePool({ scopes: [] });
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(result.closed).toEqual([]);
  });

  it('满足条件的 scope 被标记为 completed', async () => {
    const pool = makeScopePool({
      scopes: [{ id: 'scope-1', title: 'Scope Alpha', project_id: 'proj-1' }],
    });
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toMatchObject({ id: 'scope-1', title: 'Scope Alpha' });
  });

  it('创建 okr_project_plan 任务', async () => {
    const pool = makeScopePool({
      scopes: [{ id: 'scope-1', title: 'Scope Alpha', project_id: 'proj-1' }],
      existingPlan: [],
      projectTitle: 'Project Gamma',
    });
    await checkOkrScopeCompletion(pool);
    const hasPlanInsert = pool.query.mock.calls.some(c =>
      c[0].includes('okr_project_plan')
    );
    expect(hasPlanInsert).toBe(true);
  });

  it('已存在 okr_project_plan 时不重复创建', async () => {
    const pool = makeScopePool({
      scopes: [{ id: 'scope-1', title: 'Scope Alpha', project_id: 'proj-1' }],
      existingPlan: [{ id: 'task-x' }],
    });
    await checkOkrScopeCompletion(pool);
    const insertCalls = pool.query.mock.calls.filter(c =>
      c[0].includes('INSERT INTO tasks') && c[0].includes('okr_project_plan')
    );
    expect(insertCalls.length).toBe(0);
  });

  it('scope 无 project_id 时不创建 project_plan 任务', async () => {
    const pool = makeScopePool({
      scopes: [{ id: 'scope-orphan', title: 'Orphan Scope', project_id: null }],
    });
    const result = await checkOkrScopeCompletion(pool);
    expect(result.closedCount).toBe(1);
    const insertCalls = pool.query.mock.calls.filter(c =>
      c[0].includes('INSERT INTO tasks') && c[0].includes('okr_project_plan')
    );
    expect(insertCalls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkOkrProjectCompletion
// ════════════════════════════════════════════════════════════════════════════

describe('checkOkrProjectCompletion', () => {
  it('无满足条件的 project 时返回 closedCount=0', async () => {
    const pool = makeProjectPool({ projects: [] });
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(0);
    expect(result.closed).toEqual([]);
  });

  it('满足条件的 project 被标记为 completed', async () => {
    const pool = makeProjectPool({
      projects: [{ id: 'proj-1', title: 'Project Delta', kr_id: 'kr-1' }],
    });
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toMatchObject({ id: 'proj-1', title: 'Project Delta', kr_id: 'kr-1' });
  });

  it('记录 cecelia_events', async () => {
    const pool = makeProjectPool({
      projects: [{ id: 'proj-1', title: 'Project Delta', kr_id: 'kr-1' }],
    });
    await checkOkrProjectCompletion(pool);
    const eventCalls = pool.query.mock.calls.filter(c =>
      c[0].includes('INSERT INTO cecelia_events') && c[0].includes('okr_project_completed')
    );
    expect(eventCalls.length).toBe(1);
  });

  it('多个 project 同时完成', async () => {
    const pool = makeProjectPool({
      projects: [
        { id: 'proj-1', title: 'Project A', kr_id: 'kr-1' },
        { id: 'proj-2', title: 'Project B', kr_id: 'kr-2' },
      ],
    });
    const result = await checkOkrProjectCompletion(pool);
    expect(result.closedCount).toBe(2);
    expect(result.closed).toHaveLength(2);
  });
});
