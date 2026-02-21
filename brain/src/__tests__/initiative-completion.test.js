/**
 * Initiative 闭环检查器测试
 * DoD: D1-D5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkInitiativeCompletion } from '../initiative-closer.js';

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

      // 查某 initiative 下的 tasks 统计
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

      // UPDATE projects
      if (s.includes('UPDATE projects') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT INTO cecelia_events
      if (s.includes('cecelia_events') && s.includes('initiative_completed')) {
        return { rows: [] };
      }

      return { rows: [] };
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
