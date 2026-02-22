/**
 * Initiative 闭环检查器测试
 * DoD: D1-D5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkInitiativeCompletion, checkProjectCompletion } from '../initiative-closer.js';

// ────────────────────────────────────────────────────────────────────────────
// 工具函数：构造 mock pool
// ────────────────────────────────────────────────────────────────────────────

/**
 * 构造 mock pool。
 * @param {Array} initiatives  - [ { id, name } ]，表示 in_progress initiatives
 * @param {Object} taskStats   - initiativeId → { total, queued, in_progress }
 */
function makeMockPool(initiatives = [], taskStats = {}) {
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查 in_progress initiatives
      if (s.includes("type = 'initiative'") && s.includes("status = 'in_progress'")) {
        return { rows: initiatives };
      }

      // 查某 initiative 下的 tasks 统计（FROM tasks WHERE project_id）
      if (s.includes('COUNT(*)') && s.includes('FROM tasks') && s.includes('project_id = $1')) {
        const id = params?.[0];
        const stats = taskStats[id] || { total: '0', queued: '0', in_progress: '0' };
        return {
          rows: [{
            total: String(stats.total ?? 0),
            queued: String(stats.queued ?? 0),
            in_progress: String(stats.in_progress ?? 0),
          }],
        };
      }

      // UPDATE projects SET completed
      if (s.includes('UPDATE projects') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT INTO cecelia_events（initiative_completed）
      if (s.includes('cecelia_events') && s.includes('initiative_completed')) {
        return { rows: [] };
      }

      // activateNextInitiatives - 查当前 active 数量（包含 active + in_progress）
      if (s.includes('COUNT(*)') && s.includes("status IN ('active', 'in_progress')")) {
        return { rows: [{ cnt: '5' }] };
      }

      // activateNextInitiatives - UPDATE projects active + RETURNING
      if (
        s.includes('UPDATE projects') &&
        s.includes("status = 'active'") &&
        s.includes('RETURNING id, name')
      ) {
        return { rows: [], rowCount: 0 };
      }

      // INSERT INTO cecelia_events（initiatives_activated）
      if (s.includes('initiatives_activated')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// D1: 所有 tasks completed → initiative 被关闭
// ────────────────────────────────────────────────────────────────────────────
describe('D1: 所有 tasks completed 时关闭 initiative', () => {
  it('应当关闭 initiative（total=5, queued=0, in_progress=0）', async () => {
    const initiatives = [{ id: 'init-001', name: 'Test Initiative' }];
    const taskStats = {
      'init-001': { total: 5, queued: 0, in_progress: 0 },
    };
    const pool = makeMockPool(initiatives, taskStats);

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].id).toBe('init-001');
    expect(result.closed[0].name).toBe('Test Initiative');
  });

  it('UPDATE projects 和 INSERT cecelia_events 各被调用一次', async () => {
    const initiatives = [{ id: 'init-002', name: 'Another Initiative' }];
    const taskStats = {
      'init-002': { total: 3, queued: 0, in_progress: 0 },
    };
    const pool = makeMockPool(initiatives, taskStats);

    await checkInitiativeCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects') && s.includes("status = 'completed'"));
    const hasInsert = calls.some(s => s.includes('cecelia_events') && s.includes('initiative_completed'));
    expect(hasUpdate).toBe(true);
    expect(hasInsert).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D2: 有 in_progress task → 不关闭
// ────────────────────────────────────────────────────────────────────────────
describe('D2: 有 in_progress task 时不关闭', () => {
  it('应当跳过（total=5, queued=0, in_progress=2）', async () => {
    const initiatives = [{ id: 'init-003', name: 'Running Initiative' }];
    const taskStats = {
      'init-003': { total: 5, queued: 0, in_progress: 2 },
    };
    const pool = makeMockPool(initiatives, taskStats);

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);

    // 不应该调用 UPDATE
    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects'));
    expect(hasUpdate).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D3: 有 queued task → 不关闭
// ────────────────────────────────────────────────────────────────────────────
describe('D3: 有 queued task 时不关闭', () => {
  it('应当跳过（total=5, queued=3, in_progress=0）', async () => {
    const initiatives = [{ id: 'init-004', name: 'Queued Initiative' }];
    const taskStats = {
      'init-004': { total: 5, queued: 3, in_progress: 0 },
    };
    const pool = makeMockPool(initiatives, taskStats);

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects'));
    expect(hasUpdate).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D4: tasks 全为空（total=0）→ 不关闭（避免误关空 initiative）
// ────────────────────────────────────────────────────────────────────────────
describe('D4: 没有 tasks 时不关闭（避免空 initiative 误关）', () => {
  it('应当跳过（total=0, queued=0, in_progress=0）', async () => {
    const initiatives = [{ id: 'init-005', name: 'Empty Initiative' }];
    const taskStats = {
      'init-005': { total: 0, queued: 0, in_progress: 0 },
    };
    const pool = makeMockPool(initiatives, taskStats);

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// D5: 已经 completed 的 initiative → 不重复处理
// ────────────────────────────────────────────────────────────────────────────
describe('D5: 已 completed 的 initiative 不重复处理', () => {
  it('只查询 status=in_progress 的，已 completed 的不出现在结果集', async () => {
    // SQL 只查 in_progress，这里模拟返回空（已 completed 的不返回）
    const pool = makeMockPool([], {});

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);

    // 确认只调用了一次 query（查 initiatives 列表）
    expect(pool.query).toHaveBeenCalledOnce();
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain("status = 'in_progress'");
  });

  it('多个 initiatives 中只有满足条件的被关闭', async () => {
    const initiatives = [
      { id: 'init-006', name: 'Done Initiative' },
      { id: 'init-007', name: 'Still Running' },
    ];
    const taskStats = {
      'init-006': { total: 3, queued: 0, in_progress: 0 },  // 应该关闭
      'init-007': { total: 2, queued: 1, in_progress: 0 },  // 不关闭
    };
    const pool = makeMockPool(initiatives, taskStats);

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed[0].id).toBe('init-006');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Project 闭环检查器测试
// ════════════════════════════════════════════════════════════════════════════

/**
 * 构造 mock pool，模拟 checkProjectCompletion 的 SQL 查询。
 *
 * @param {Array} activeProjects - 满足条件的 active projects（SELECT 结果）
 */
function makeMockProjectPool(activeProjects = []) {
  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查满足条件的 active projects（主查询）
      if (s.includes("type = 'project'") && s.includes("status = 'active'")) {
        return { rows: activeProjects };
      }

      // UPDATE projects SET status='completed'
      if (s.includes('UPDATE projects') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT INTO cecelia_events（project_completed）
      if (s.includes('cecelia_events') && s.includes('project_completed')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// P1: 所有 initiative completed → project 被关闭
// ────────────────────────────────────────────────────────────────────────────
describe('P1: 所有 initiative completed 时关闭 project', () => {
  it('应当关闭 project（SQL 返回满足条件的 project）', async () => {
    const activeProjects = [
      { id: 'proj-001', name: 'Test Project', kr_id: 'kr-001' },
    ];
    const pool = makeMockProjectPool(activeProjects);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed).toHaveLength(1);
    expect(result.closed[0].id).toBe('proj-001');
    expect(result.closed[0].name).toBe('Test Project');
    expect(result.closed[0].kr_id).toBe('kr-001');
  });

  it('UPDATE projects 和 INSERT cecelia_events 各被调用一次', async () => {
    const activeProjects = [
      { id: 'proj-002', name: 'Another Project', kr_id: 'kr-001' },
    ];
    const pool = makeMockProjectPool(activeProjects);

    await checkProjectCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects') && s.includes("status = 'completed'"));
    const hasInsert = calls.some(s => s.includes('cecelia_events') && s.includes('project_completed'));
    expect(hasUpdate).toBe(true);
    expect(hasInsert).toBe(true);
  });

  it('多个 project 同时满足条件时，全部关闭', async () => {
    const activeProjects = [
      { id: 'proj-003', name: 'Project A', kr_id: 'kr-001' },
      { id: 'proj-004', name: 'Project B', kr_id: 'kr-002' },
    ];
    const pool = makeMockProjectPool(activeProjects);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(2);
    expect(result.closed).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P2: 有 initiative 未完成 → 不关闭
// ────────────────────────────────────────────────────────────────────────────
describe('P2: 有 initiative 未完成时不关闭 project', () => {
  it('SQL NOT EXISTS 过滤掉有未完成 initiative 的 project，返回空列表', async () => {
    // SQL 层面已过滤，mock 返回空列表
    const pool = makeMockProjectPool([]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);

    // 只调用了一次 query（查 projects 列表）
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('不应当调用 UPDATE 或 INSERT（没有满足条件的 project）', async () => {
    const pool = makeMockProjectPool([]);

    await checkProjectCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE projects'));
    const hasInsert = calls.some(s => s.includes('cecelia_events'));
    expect(hasUpdate).toBe(false);
    expect(hasInsert).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P3: 没有任何 initiative → 不关闭（避免误关空 project）
// ────────────────────────────────────────────────────────────────────────────
describe('P3: 没有任何 initiative 时不关闭 project', () => {
  it('SQL EXISTS 子查询过滤掉无 initiative 的 project，返回空列表', async () => {
    // SQL 层面已过滤（AND EXISTS 子查询），mock 返回空列表
    const pool = makeMockProjectPool([]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// P4: 已经 completed 的 project → 不重复处理
// ────────────────────────────────────────────────────────────────────────────
describe('P4: 已 completed 的 project 不重复处理', () => {
  it('只查询 status=active 的 project，已 completed 的不会出现在查询结果中', async () => {
    // SQL WHERE status='active' 已过滤，mock 返回空列表
    const pool = makeMockProjectPool([]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);

    // 验证主查询包含 status='active' 条件
    const [mainSql] = pool.query.mock.calls[0];
    expect(mainSql).toContain("status = 'active'");
    expect(mainSql).toContain("type = 'project'");
  });

  it('SQL 查询包含 NOT EXISTS 和 AND EXISTS 子查询（确保逻辑正确）', async () => {
    const pool = makeMockProjectPool([]);

    await checkProjectCompletion(pool);

    const [mainSql] = pool.query.mock.calls[0];
    expect(mainSql).toContain('NOT EXISTS');
    expect(mainSql).toContain('AND EXISTS');
    expect(mainSql).toContain("type = 'initiative'");
  });
});
