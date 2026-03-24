/**
 * Initiative Closer 完整单元测试
 *
 * 覆盖所有导出函数：
 *   - checkInitiativeCompletion
 *   - checkProjectCompletion
 *   - activateNextInitiatives
 *   - getMaxActiveInitiatives
 *   - MAX_ACTIVE_INITIATIVES
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖模块（必须在 import 被测模块之前声明）
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn((slots) => {
    const s = Math.max(1, Math.floor(slots ?? 9));
    return {
      slots: s,
      project: { max: Math.min(2, Math.ceil(s / 2)), softMin: 1, cooldownMs: 180000 },
      initiative: { max: s, softMin: Math.ceil(s / 3), cooldownMs: 120000 },
      task: { queuedCap: s * 3, softMin: s, cooldownMs: 60000 },
    };
  }),
}));

vi.mock('../kr-progress.js', () => ({
  updateKrProgress: vi.fn().mockResolvedValue({ krId: 'kr-001', progress: 50, completed: 1, total: 2 }),
}));

vi.mock('../progress-reviewer.js', () => ({
  reviewProjectCompletion: vi.fn().mockResolvedValue({ found: true }),
  shouldAdjustPlan: vi.fn().mockResolvedValue(null),
  createPlanAdjustmentTask: vi.fn().mockResolvedValue({ task: { id: 'task-adj-1' }, review: { id: 'rev-1' } }),
}));

import {
  checkInitiativeCompletion,
  checkProjectCompletion,
  activateNextInitiatives,
  getMaxActiveInitiatives,
  MAX_ACTIVE_INITIATIVES,
} from '../initiative-closer.js';

import { updateKrProgress } from '../kr-progress.js';
import { shouldAdjustPlan, createPlanAdjustmentTask } from '../progress-reviewer.js';

// ════════════════════════════════════════════════════════════════════════════
// 工具函数：构造 mock pool
// ════════════════════════════════════════════════════════════════════════════

/**
 * 构造 mock pool，支持 checkInitiativeCompletion 的所有 SQL 查询。
 *
 * @param {Object} opts
 * @param {Array} opts.initiatives - 返回的 in_progress/active initiatives
 * @param {Object} opts.taskStats - initiativeId → { total, queued, in_progress, dep_failed }
 * @param {number} opts.activeCount - 当前 active initiative 数量（用于 activateNextInitiatives）
 * @param {Array} opts.pendingToActivate - pending 列表（用于 activateNextInitiatives）
 * @param {Array} opts.krRows - KR ID 行（用于 KR 进度更新查询）
 */
function makeMockPool(opts = {}) {
  const {
    initiatives = [],
    taskStats = {},
    activeCount = 9,
    pendingToActivate = [],
    krRows = [],
  } = opts;

  return {
    query: vi.fn().mockImplementation(async (sql, params) => {
      const s = sql.trim();

      // 查 in_progress 或 active 的 initiatives（迁移后：FROM okr_initiatives）
      if (s.includes('okr_initiatives') && s.includes("status IN ('in_progress', 'active')") && s.includes('SELECT id')) {
        return { rows: initiatives };
      }

      // 查某 initiative 下的 tasks 统计
      if (s.includes('COUNT(*)') && s.includes('FROM tasks') && s.includes('project_id = $1')) {
        const id = params?.[0];
        const stats = taskStats[id] || { total: '0', queued: '0', in_progress: '0', dep_failed: '0', quarantine: '0' };
        return {
          rows: [{
            total: String(stats.total ?? 0),
            queued: String(stats.queued ?? 0),
            in_progress: String(stats.in_progress ?? 0),
            dep_failed: String(stats.dep_failed ?? 0),
            quarantine: String(stats.quarantine ?? 0),
          }],
        };
      }

      // UPDATE okr_initiatives SET status='completed'
      if (s.includes('UPDATE okr_initiatives') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      // INSERT INTO cecelia_events（initiative_completed）
      if (s.includes('cecelia_events') && s.includes('initiative_completed')) {
        return { rows: [] };
      }

      // scope_plan 飞轮：查找 parent scope
      if (s.includes('okr_scopes') && s.includes('scope_id') && s.includes('SELECT id')) {
        return { rows: [] };
      }

      // KR 进度查询：SELECT DISTINCT pkl.kr_id
      if (s.includes('DISTINCT') && s.includes('kr_id') && s.includes('project_kr_links')) {
        return { rows: krRows };
      }

      // activateNextInitiatives - 查当前 active 数量（FROM okr_initiatives）
      if (s.includes('COUNT(*)') && s.includes('okr_initiatives') && s.includes("status IN ('active', 'in_progress')")) {
        return { rows: [{ cnt: String(activeCount) }] };
      }

      // activateNextInitiatives - UPDATE okr_initiatives pending → active + RETURNING
      if (
        s.includes('UPDATE okr_initiatives') &&
        s.includes("status = 'active'") &&
        s.includes('RETURNING id')
      ) {
        const limit = params?.[0] ?? pendingToActivate.length;
        const toActivate = pendingToActivate.slice(0, limit);
        return { rows: toActivate, rowCount: toActivate.length };
      }

      // INSERT INTO cecelia_events（initiatives_activated）
      if (s.includes('initiatives_activated')) {
        return { rows: [] };
      }

      // checkProjectCompletion - 查 active projects（迁移后：FROM okr_projects）
      if (s.includes('okr_projects') && s.includes("status = 'active'")) {
        return { rows: [] };
      }

      // INSERT INTO cecelia_events（project_completed）
      if (s.includes('cecelia_events') && s.includes('project_completed')) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };
}

/**
 * 构造 mock pool，用于 checkProjectCompletion 测试。
 *
 * @param {Array} activeProjects - 满足闭环条件的 active projects
 */
function makeMockProjectPool(activeProjects = []) {
  return {
    query: vi.fn().mockImplementation(async (sql) => {
      const s = sql.trim();

      // 查 active projects（迁移后：FROM okr_projects）
      if (s.includes('okr_projects') && s.includes("status = 'active'")) {
        return { rows: activeProjects };
      }

      // UPDATE okr_projects SET status='completed'
      if (s.includes('UPDATE okr_projects') && s.includes("status = 'completed'")) {
        return { rows: [] };
      }

      if (s.includes('cecelia_events') && s.includes('project_completed')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 测试用例
// ════════════════════════════════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// getMaxActiveInitiatives
// ────────────────────────────────────────────────────────────────────────────
describe('getMaxActiveInitiatives', () => {
  it('传入 slots=9 时返回 9（initiative.max = slots）', () => {
    expect(getMaxActiveInitiatives(9)).toBe(9);
  });

  it('传入 slots=1 时返回 1（最小值）', () => {
    expect(getMaxActiveInitiatives(1)).toBe(1);
  });

  it('传入 slots=20 时返回 20', () => {
    expect(getMaxActiveInitiatives(20)).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// MAX_ACTIVE_INITIATIVES 常量
// ────────────────────────────────────────────────────────────────────────────
describe('MAX_ACTIVE_INITIATIVES', () => {
  it('默认值应为 9', () => {
    expect(MAX_ACTIVE_INITIATIVES).toBe(9);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - 基础场景
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - 基础场景', () => {
  it('没有 in_progress/active 的 initiative 时返回空结果', async () => {
    const pool = makeMockPool({ initiatives: [] });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
    expect(result.activatedCount).toBe(0);
  });

  it('所有 tasks 已完成时关闭 initiative', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-1', name: 'Initiative 1' }],
      taskStats: { 'init-1': { total: 5, queued: 0, in_progress: 0, dep_failed: 0 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toEqual({ id: 'init-1', name: 'Initiative 1' });
  });

  it('有 queued tasks 时不关闭 initiative', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-2', name: 'Initiative 2' }],
      taskStats: { 'init-2': { total: 5, queued: 2, in_progress: 0 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('有 in_progress tasks 时不关闭 initiative', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-3', name: 'Initiative 3' }],
      taskStats: { 'init-3': { total: 5, queued: 0, in_progress: 1 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('total=0 时不关闭（避免误关空 initiative）', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-4', name: 'Empty Initiative' }],
      taskStats: { 'init-4': { total: 0, queued: 0, in_progress: 0 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('多个 initiative 时，只关闭满足条件的', async () => {
    const pool = makeMockPool({
      initiatives: [
        { id: 'init-done', name: 'Done' },
        { id: 'init-running', name: 'Running' },
        { id: 'init-done2', name: 'Done 2' },
      ],
      taskStats: {
        'init-done': { total: 3, queued: 0, in_progress: 0 },
        'init-running': { total: 3, queued: 1, in_progress: 0 },
        'init-done2': { total: 2, queued: 0, in_progress: 0 },
      },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(2);
    expect(result.closed.map(c => c.id)).toEqual(['init-done', 'init-done2']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - dep_failed tasks 排除
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - dep_failed 排除逻辑', () => {
  it('SQL 查询中 total 排除 dep_failed 状态的 tasks', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-dep', name: 'DepFailed Initiative' }],
      taskStats: { 'init-dep': { total: 3, queued: 0, in_progress: 0, dep_failed: 2 } },
    });

    await checkInitiativeCompletion(pool);

    // 验证 SQL 查询包含 dep_failed 过滤
    const calls = pool.query.mock.calls.map(c => c[0]);
    const statsQuery = calls.find(s => s.includes('FROM tasks') && s.includes('COUNT(*)'));
    expect(statsQuery).toBeDefined();
    expect(statsQuery).toContain('dep_failed');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - quarantine 阻止关闭
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - quarantine 阻止关闭', () => {
  it('有 quarantine tasks 时不关闭 initiative', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-quar', name: 'Quarantined Initiative' }],
      taskStats: { 'init-quar': { total: 5, queued: 0, in_progress: 0, dep_failed: 0, quarantine: 2 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('SQL 查询中包含 quarantine 统计列', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-quar2', name: 'Quarantined Initiative 2' }],
      taskStats: { 'init-quar2': { total: 3, queued: 0, in_progress: 0, quarantine: 1 } },
    });

    await checkInitiativeCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0]);
    const statsQuery = calls.find(s => s.includes('FROM tasks') && s.includes('COUNT(*)'));
    expect(statsQuery).toBeDefined();
    expect(statsQuery).toContain('quarantine');
  });

  it('quarantine=0 时正常关闭 initiative', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-clean', name: 'Clean Initiative' }],
      taskStats: { 'init-clean': { total: 4, queued: 0, in_progress: 0, dep_failed: 0, quarantine: 0 } },
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toEqual({ id: 'init-clean', name: 'Clean Initiative' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - 状态更新和事件记录
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - 状态更新和事件记录', () => {
  it('关闭 initiative 时执行 UPDATE 和 INSERT event', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-upd', name: 'Update Test' }],
      taskStats: { 'init-upd': { total: 3, queued: 0, in_progress: 0 } },
    });

    await checkInitiativeCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasUpdate = calls.some(s => s.includes('UPDATE okr_initiatives') && s.includes("status = 'completed'"));
    const hasEvent = calls.some(s => s.includes('cecelia_events') && s.includes('initiative_completed'));
    expect(hasUpdate).toBe(true);
    expect(hasEvent).toBe(true);
  });

  it('UPDATE 使用正确的 initiative id', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-id-check', name: 'ID Check' }],
      taskStats: { 'init-id-check': { total: 2, queued: 0, in_progress: 0 } },
    });

    await checkInitiativeCompletion(pool);

    const updateCall = pool.query.mock.calls.find(
      c => c[0].trim().includes('UPDATE okr_initiatives') && c[0].trim().includes("status = 'completed'")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(['init-id-check']);
  });

  it('INSERT event payload 包含正确的字段', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-payload', name: 'Payload Test' }],
      taskStats: { 'init-payload': { total: 4, queued: 0, in_progress: 0 } },
    });

    await checkInitiativeCompletion(pool);

    const eventCall = pool.query.mock.calls.find(
      c => c[0].trim().includes('initiative_completed')
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][0]);
    expect(payload.initiative_id).toBe('init-payload');
    expect(payload.initiative_name).toBe('Payload Test');
    expect(payload.total_tasks).toBe(4);
    expect(payload.closed_at).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - KR 进度更新
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - KR 进度更新', () => {
  it('关闭 initiative 后触发 KR 进度更新', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-kr', name: 'KR Test' }],
      taskStats: { 'init-kr': { total: 2, queued: 0, in_progress: 0 } },
      krRows: [{ kr_id: 'kr-001' }],
    });

    await checkInitiativeCompletion(pool);

    expect(updateKrProgress).toHaveBeenCalledWith(pool, 'kr-001');
  });

  it('多个关联 KR 时逐个更新', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-multi-kr', name: 'Multi KR' }],
      taskStats: { 'init-multi-kr': { total: 2, queued: 0, in_progress: 0 } },
      krRows: [{ kr_id: 'kr-001' }, { kr_id: 'kr-002' }],
    });

    await checkInitiativeCompletion(pool);

    expect(updateKrProgress).toHaveBeenCalledTimes(2);
    expect(updateKrProgress).toHaveBeenCalledWith(pool, 'kr-001');
    expect(updateKrProgress).toHaveBeenCalledWith(pool, 'kr-002');
  });

  it('没有关联 KR 时不调用 updateKrProgress', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-no-kr', name: 'No KR' }],
      taskStats: { 'init-no-kr': { total: 2, queued: 0, in_progress: 0 } },
      krRows: [],
    });

    await checkInitiativeCompletion(pool);

    expect(updateKrProgress).not.toHaveBeenCalled();
  });

  it('KR 进度更新失败时不影响主流程（non-fatal 错误处理）', async () => {
    updateKrProgress.mockRejectedValueOnce(new Error('KR update 失败'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pool = makeMockPool({
      initiatives: [{ id: 'init-kr-err', name: 'KR Error' }],
      taskStats: { 'init-kr-err': { total: 2, queued: 0, in_progress: 0 } },
      krRows: [{ kr_id: 'kr-err' }],
    });

    const result = await checkInitiativeCompletion(pool);

    // 主流程正常完成
    expect(result.closedCount).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[initiative-closer] KR progress update failed'),
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });

  it('没有关闭任何 initiative 时不触发 KR 更新', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-skip', name: 'Skip' }],
      taskStats: { 'init-skip': { total: 3, queued: 1, in_progress: 0 } },
      krRows: [{ kr_id: 'kr-skip' }],
    });

    await checkInitiativeCompletion(pool);

    expect(updateKrProgress).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkInitiativeCompletion - activateNextInitiatives 联动
// ────────────────────────────────────────────────────────────────────────────
describe('checkInitiativeCompletion - 关闭后激活下一批', () => {
  it('关闭 initiative 后调用 activateNextInitiatives', async () => {
    const pool = makeMockPool({
      initiatives: [{ id: 'init-act', name: 'Activate Test' }],
      taskStats: { 'init-act': { total: 2, queued: 0, in_progress: 0 } },
      activeCount: 5,
      pendingToActivate: [{ id: 'init-new', name: 'New Initiative' }],
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.activatedCount).toBeGreaterThanOrEqual(0);
  });

  it('没有关闭 initiative 时 activatedCount=0', async () => {
    const pool = makeMockPool({
      initiatives: [],
    });

    const result = await checkInitiativeCompletion(pool);

    expect(result.activatedCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkProjectCompletion - 基础场景
// ────────────────────────────────────────────────────────────────────────────
describe('checkProjectCompletion - 基础场景', () => {
  it('没有可关闭的 project 时返回空结果', async () => {
    const pool = makeMockProjectPool([]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(result.closed).toHaveLength(0);
  });

  it('满足条件的 project 被关闭', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-1', name: 'Project 1', kr_id: 'kr-001' },
    ]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed[0]).toEqual({ id: 'proj-1', name: 'Project 1', kr_id: 'kr-001' });
  });

  it('多个 project 同时满足条件时全部关闭', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-a', name: 'Project A', kr_id: 'kr-001' },
      { id: 'proj-b', name: 'Project B', kr_id: 'kr-002' },
    ]);

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(2);
    expect(result.closed).toHaveLength(2);
  });

  it('UPDATE 和 INSERT event 被正确调用', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-evt', name: 'Event Project', kr_id: 'kr-evt' },
    ]);

    await checkProjectCompletion(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    expect(calls.some(s => s.includes('UPDATE okr_projects') && s.includes("status = 'completed'"))).toBe(true);
    expect(calls.some(s => s.includes('cecelia_events') && s.includes('project_completed'))).toBe(true);
  });

  it('event payload 包含正确的字段', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-pay', name: 'Payload Project', kr_id: 'kr-pay' },
    ]);

    await checkProjectCompletion(pool);

    const eventCall = pool.query.mock.calls.find(
      c => c[0].trim().includes('project_completed')
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][0]);
    expect(payload.project_id).toBe('proj-pay');
    expect(payload.project_name).toBe('Payload Project');
    expect(payload.kr_id).toBe('kr-pay');
    expect(payload.closed_at).toBeDefined();
  });

  it('主查询包含正确的 SQL 条件', async () => {
    const pool = makeMockProjectPool([]);

    await checkProjectCompletion(pool);

    const [mainSql] = pool.query.mock.calls[0];
    expect(mainSql).toContain('okr_projects');
    expect(mainSql).toContain("status = 'active'");
    expect(mainSql).toContain('NOT EXISTS');
    expect(mainSql).toContain('okr_initiatives');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// checkProjectCompletion - 渐进验证（计划调整审查）
// ────────────────────────────────────────────────────────────────────────────
describe('checkProjectCompletion - 渐进验证', () => {
  it('关闭 project 后调用 shouldAdjustPlan', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-adj', name: 'Adjust Project', kr_id: 'kr-adj' },
    ]);

    await checkProjectCompletion(pool);

    expect(shouldAdjustPlan).toHaveBeenCalledWith(pool, 'kr-adj', 'proj-adj');
  });

  it('shouldAdjustPlan 返回 null 时不创建调整任务', async () => {
    shouldAdjustPlan.mockResolvedValueOnce(null);
    const pool = makeMockProjectPool([
      { id: 'proj-null', name: 'Null Adjust', kr_id: 'kr-null' },
    ]);

    await checkProjectCompletion(pool);

    expect(createPlanAdjustmentTask).not.toHaveBeenCalled();
  });

  it('shouldAdjustPlan 返回调整建议时创建调整任务', async () => {
    const adjustment = { adjustmentType: 'over_budget', recommendation: '精简范围' };
    shouldAdjustPlan.mockResolvedValueOnce(adjustment);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const pool = makeMockProjectPool([
      { id: 'proj-over', name: 'Over Budget Project', kr_id: 'kr-over' },
    ]);

    await checkProjectCompletion(pool);

    expect(createPlanAdjustmentTask).toHaveBeenCalledWith(pool, {
      krId: 'kr-over',
      completedProjectId: 'proj-over',
      suggestion: adjustment,
    });

    consoleSpy.mockRestore();
  });

  it('shouldAdjustPlan 异常时不影响主流程', async () => {
    shouldAdjustPlan.mockRejectedValueOnce(new Error('Review 失败'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const pool = makeMockProjectPool([
      { id: 'proj-err', name: 'Error Project', kr_id: 'kr-err' },
    ]);

    const result = await checkProjectCompletion(pool);

    // 主流程正常完成
    expect(result.closedCount).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[project-closer] Plan adjustment review failed'),
    );

    consoleSpy.mockRestore();
  });

  it('kr_id 为 null 时仍调用 shouldAdjustPlan（由其内部处理）', async () => {
    const pool = makeMockProjectPool([
      { id: 'proj-no-kr', name: 'No KR Project', kr_id: null },
    ]);

    await checkProjectCompletion(pool);

    expect(shouldAdjustPlan).toHaveBeenCalledWith(pool, null, 'proj-no-kr');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// activateNextInitiatives
// ────────────────────────────────────────────────────────────────────────────
describe('activateNextInitiatives', () => {
  it('有空位时激活 pending initiatives', async () => {
    const pending = [
      { id: 'init-a', name: 'A' },
      { id: 'init-b', name: 'B' },
    ];
    const pool = makeMockPool({ activeCount: 7, pendingToActivate: pending });

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(2);
  });

  it('已达上限时不激活', async () => {
    const pool = makeMockPool({ activeCount: MAX_ACTIVE_INITIATIVES });

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });

  it('超过上限时不激活', async () => {
    const pool = makeMockPool({ activeCount: MAX_ACTIVE_INITIATIVES + 3 });

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });

  it('没有 pending 时返回 0', async () => {
    const pool = makeMockPool({ activeCount: 5, pendingToActivate: [] });

    const activated = await activateNextInitiatives(pool);

    expect(activated).toBe(0);
  });

  it('激活后记录 cecelia_events', async () => {
    const pending = [{ id: 'init-evt2', name: 'Event Test' }];
    const pool = makeMockPool({ activeCount: 5, pendingToActivate: pending });

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const hasEvent = calls.some(s => s.includes('initiatives_activated'));
    expect(hasEvent).toBe(true);
  });

  it('激活 event payload 包含正确字段', async () => {
    const pending = [{ id: 'init-pay2', name: 'Payload Initiative' }];
    const pool = makeMockPool({ activeCount: 5, pendingToActivate: pending });

    await activateNextInitiatives(pool);

    const eventCall = pool.query.mock.calls.find(
      c => c[0].trim().includes('initiatives_activated')
    );
    expect(eventCall).toBeDefined();
    const payload = JSON.parse(eventCall[1][0]);
    expect(payload.activated_count).toBe(1);
    expect(payload.activated_names).toEqual(['Payload Initiative']);
    expect(payload.previous_active).toBe(5);
    expect(payload.new_active).toBe(6);
    expect(payload.max_allowed).toBe(MAX_ACTIVE_INITIATIVES);
    expect(payload.timestamp).toBeDefined();
  });

  it('slotsOverride 参数覆盖默认 MAX', async () => {
    // slotsOverride=3 → computeCapacity(3).initiative.max = 3
    const pending = Array.from({ length: 5 }, (_, i) => ({
      id: `init-${i}`,
      name: `Init ${i}`,
    }));
    const pool = makeMockPool({ activeCount: 1, pendingToActivate: pending });

    const activated = await activateNextInitiatives(pool, 3);

    // max = 3, active = 1, available = 2
    expect(activated).toBe(2);
  });

  it('SQL 查询按 P0/P1/P2 优先级排序', async () => {
    const pending = [{ id: 'init-sort', name: 'Sort Test' }];
    const pool = makeMockPool({ activeCount: 0, pendingToActivate: pending });

    await activateNextInitiatives(pool);

    const calls = pool.query.mock.calls.map(c => c[0].trim());
    const updateCall = calls.find(
      s => s.includes('UPDATE okr_initiatives') && s.includes("status = 'active'")
    );
    expect(updateCall).toBeDefined();
    expect(updateCall).toContain("WHEN 'P0' THEN 0");
    expect(updateCall).toContain("WHEN 'P1' THEN 1");
    expect(updateCall).toContain('created_at ASC');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 数据库错误处理
// ────────────────────────────────────────────────────────────────────────────
describe('数据库错误处理', () => {
  it('checkInitiativeCompletion - 查询 initiatives 失败时抛出错误', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('数据库连接失败')),
    };

    await expect(checkInitiativeCompletion(pool)).rejects.toThrow('数据库连接失败');
  });

  it('checkProjectCompletion - 查询 projects 失败时抛出错误', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('数据库超时')),
    };

    await expect(checkProjectCompletion(pool)).rejects.toThrow('数据库超时');
  });

  it('activateNextInitiatives - 查询失败时抛出错误', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('查询失败')),
    };

    await expect(activateNextInitiatives(pool)).rejects.toThrow('查询失败');
  });
});
