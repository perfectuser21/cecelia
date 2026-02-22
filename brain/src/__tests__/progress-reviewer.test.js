/**
 * Progress Reviewer Unit Tests
 *
 * DoD 覆盖: D1-D5, D8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock task-router.js
vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'hk'),
}));

import {
  reviewProjectCompletion,
  shouldAdjustPlan,
  createPlanAdjustmentTask,
  executePlanAdjustment,
} from '../progress-reviewer.js';

function makeMockPool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe('reviewProjectCompletion', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D1: 收集 initiative 数、task 数、actual_days', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      // Project 信息
      if (sql.includes('SELECT id, name, status')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test Project', status: 'completed',
            created_at: tenDaysAgo.toISOString(), completed_at: now.toISOString(),
            time_budget_days: 14, kr_id: 'kr-1', parent_id: null,
          }],
        };
      }
      // Initiative 统计
      if (sql.includes('FROM projects WHERE parent_id')) {
        return { rows: [{ total: '3', completed: '3' }] };
      }
      // Task 统计
      if (sql.includes('FROM tasks t')) {
        return { rows: [{ total: '12', completed: '10' }] };
      }
      return { rows: [] };
    });

    const result = await reviewProjectCompletion(pool, 'proj-1');
    expect(result.found).toBe(true);
    expect(result.initiativeCount).toBe(3);
    expect(result.initiativeCompleted).toBe(3);
    expect(result.taskCount).toBe(12);
    expect(result.taskCompleted).toBe(10);
    expect(result.actualDays).toBe(10);
  });

  it('D2: 对比 time_budget_days vs actual_days 生成 time_ratio', async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT id, name, status')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test', status: 'completed',
            created_at: sevenDaysAgo.toISOString(), completed_at: now.toISOString(),
            time_budget_days: 14, kr_id: 'kr-1', parent_id: null,
          }],
        };
      }
      if (sql.includes('FROM projects WHERE parent_id')) {
        return { rows: [{ total: '2', completed: '2' }] };
      }
      if (sql.includes('FROM tasks t')) {
        return { rows: [{ total: '5', completed: '5' }] };
      }
      return { rows: [] };
    });

    const result = await reviewProjectCompletion(pool, 'proj-1');
    expect(result.timeRatio).toBe(0.5);
    expect(result.budgetDays).toBe(14);
    expect(result.actualDays).toBe(7);
    expect(result.overBudget).toBe(false);
    expect(result.underBudget).toBe(false); // 0.5 is not < 0.5
  });

  it('overBudget = true 当 timeRatio > 1.0', async () => {
    const now = new Date();
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT id, name, status')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test', status: 'completed',
            created_at: twentyDaysAgo.toISOString(), completed_at: now.toISOString(),
            time_budget_days: 14, kr_id: 'kr-1', parent_id: null,
          }],
        };
      }
      if (sql.includes('FROM projects WHERE parent_id')) {
        return { rows: [{ total: '2', completed: '2' }] };
      }
      if (sql.includes('FROM tasks t')) {
        return { rows: [{ total: '5', completed: '5' }] };
      }
      return { rows: [] };
    });

    const result = await reviewProjectCompletion(pool, 'proj-1');
    expect(result.timeRatio).toBeGreaterThan(1.0);
    expect(result.overBudget).toBe(true);
  });

  it('Project 不存在 → found=false', async () => {
    pool.query = vi.fn(async () => ({ rows: [] }));
    const result = await reviewProjectCompletion(pool, 'nonexistent');
    expect(result.found).toBe(false);
  });

  it('无 time_budget_days → timeRatio=null', async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT id, name, status')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Test', status: 'completed',
            created_at: fiveDaysAgo.toISOString(), completed_at: now.toISOString(),
            time_budget_days: null, kr_id: 'kr-1', parent_id: null,
          }],
        };
      }
      if (sql.includes('FROM projects WHERE parent_id')) {
        return { rows: [{ total: '1', completed: '1' }] };
      }
      if (sql.includes('FROM tasks t')) {
        return { rows: [{ total: '3', completed: '3' }] };
      }
      return { rows: [] };
    });

    const result = await reviewProjectCompletion(pool, 'proj-1');
    expect(result.timeRatio).toBeNull();
    expect(result.overBudget).toBe(false);
  });
});

describe('shouldAdjustPlan', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D3: 有后续 pending Project → 返回 adjustment 建议', async () => {
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    pool.query = vi.fn(async (sql) => {
      // KR 下所有 Projects
      if (sql.includes('project_kr_links') && sql.includes('ORDER BY')) {
        return {
          rows: [
            { id: 'proj-1', name: 'Project 1', status: 'completed', sequence_order: 1, time_budget_days: 14 },
            { id: 'proj-2', name: 'Project 2', status: 'pending', sequence_order: 2, time_budget_days: 14 },
          ],
        };
      }
      // reviewProjectCompletion 内部查询
      if (sql.includes('SELECT id, name, status')) {
        return {
          rows: [{
            id: 'proj-1', name: 'Project 1', status: 'completed',
            created_at: tenDaysAgo.toISOString(), completed_at: now.toISOString(),
            time_budget_days: 14, kr_id: 'kr-1', parent_id: null,
          }],
        };
      }
      if (sql.includes('FROM projects WHERE parent_id')) {
        return { rows: [{ total: '2', completed: '2' }] };
      }
      if (sql.includes('FROM tasks t')) {
        return { rows: [{ total: '5', completed: '5' }] };
      }
      return { rows: [] };
    });

    const result = await shouldAdjustPlan(pool, 'kr-1', 'proj-1');
    expect(result).not.toBeNull();
    expect(result.pendingCount).toBe(1);
    expect(result.completedCount).toBe(1);
    expect(result.pendingProjects[0].name).toBe('Project 2');
  });

  it('D4: 无后续 Project → 返回 null', async () => {
    pool.query = vi.fn(async (sql) => {
      if (sql.includes('project_kr_links') && sql.includes('ORDER BY')) {
        return {
          rows: [
            { id: 'proj-1', name: 'Project 1', status: 'completed', sequence_order: 1 },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await shouldAdjustPlan(pool, 'kr-1', 'proj-1');
    expect(result).toBeNull();
  });

  it('krId 为 null → 返回 null', async () => {
    const result = await shouldAdjustPlan(pool, null, 'proj-1');
    expect(result).toBeNull();
  });
});

describe('createPlanAdjustmentTask', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D5: 创建 decomp_review task + decomp_reviews 记录', async () => {
    let reviewInserted = false;
    let taskInserted = false;

    pool.query = vi.fn(async (sql) => {
      if (sql.includes('INSERT INTO decomp_reviews')) {
        reviewInserted = true;
        return { rows: [{ id: 'review-uuid' }] };
      }
      if (sql.includes('INSERT INTO tasks')) {
        taskInserted = true;
        return { rows: [{ id: 'task-uuid', title: '计划调整审查: Test' }] };
      }
      if (sql.includes('UPDATE decomp_reviews')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await createPlanAdjustmentTask(pool, {
      krId: 'kr-1',
      completedProjectId: 'proj-1',
      suggestion: {
        completedProjectName: 'Test Project',
        actualDays: 10,
        budgetDays: 14,
        timeRatio: 0.71,
        adjustmentType: 'on_track',
        recommendation: '继续按计划执行',
        completedCount: 1,
        totalProjects: 3,
        pendingProjects: [{ id: 'proj-2', name: 'Project 2' }],
      },
    });

    expect(reviewInserted).toBe(true);
    expect(taskInserted).toBe(true);
    expect(result.task.id).toBe('task-uuid');
    expect(result.review.id).toBe('review-uuid');
  });
});

describe('executePlanAdjustment', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
  });

  it('D8: plan_adjustment findings → 更新后续 Project', async () => {
    let updateCalled = false;

    pool.query = vi.fn(async (sql, params) => {
      if (sql.includes('UPDATE projects')) {
        updateCalled = true;
        // 验证传入了正确的 project_id
        expect(params[0]).toBe('proj-2');
        return { rows: [] };
      }
      return { rows: [] };
    });

    await executePlanAdjustment(pool, {
      plan_adjustment: true,
      adjustments: [
        { project_id: 'proj-2', time_budget_days: 21 },
      ],
    }, {});

    expect(updateCalled).toBe(true);
  });

  it('无 plan_adjustment → 不执行', async () => {
    await executePlanAdjustment(pool, {}, {});
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('adjustments 为空数组 → 不执行', async () => {
    await executePlanAdjustment(pool, { plan_adjustment: true, adjustments: [] }, {});
    expect(pool.query).not.toHaveBeenCalled();
  });
});
