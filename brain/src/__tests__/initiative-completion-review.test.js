/**
 * Initiative Closer - Project 完成触发审查测试
 *
 * DoD 覆盖: D6, D7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock capacity.js
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn(() => ({
    initiative: { max: 9 },
  })),
}));

// Mock kr-progress.js
vi.mock('../kr-progress.js', () => ({
  updateKrProgress: vi.fn(async () => ({ total: 0, completed: 0, progress: 0 })),
}));

// Mock progress-reviewer.js
vi.mock('../progress-reviewer.js', () => ({
  reviewProjectCompletion: vi.fn(async () => ({ found: true })),
  shouldAdjustPlan: vi.fn(async () => null),
  createPlanAdjustmentTask: vi.fn(async () => ({ task: { id: 'task-1' }, review: { id: 'review-1' } })),
}));

import { checkProjectCompletion } from '../initiative-closer.js';
import { shouldAdjustPlan, createPlanAdjustmentTask } from '../progress-reviewer.js';

function makeMockPool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe('checkProjectCompletion - 渐进验证触发', () => {
  let pool;

  beforeEach(() => {
    pool = makeMockPool();
    vi.clearAllMocks();
  });

  it('D6: Project 全部 Initiative 完成 → 触发 shouldAdjustPlan', async () => {
    pool.query = vi.fn(async (sql) => {
      // 查询可关闭的 Projects
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'")) {
        return {
          rows: [{ id: 'proj-1', name: 'Test Project', kr_id: 'kr-1' }],
        };
      }
      // UPDATE projects (关闭)
      if (sql.includes('UPDATE projects')) {
        return { rows: [] };
      }
      // INSERT event
      if (sql.includes('INSERT INTO cecelia_events')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(1);
    expect(result.closed[0].id).toBe('proj-1');
    // 验证 shouldAdjustPlan 被调用
    expect(shouldAdjustPlan).toHaveBeenCalledWith(pool, 'kr-1', 'proj-1');
  });

  it('D7: Project 未全部完成 → 不触发审查', async () => {
    // 没有可关闭的 Projects（查询返回空）
    pool.query = vi.fn(async () => ({ rows: [] }));

    const result = await checkProjectCompletion(pool);

    expect(result.closedCount).toBe(0);
    expect(shouldAdjustPlan).not.toHaveBeenCalled();
    expect(createPlanAdjustmentTask).not.toHaveBeenCalled();
  });

  it('shouldAdjustPlan 返回 adjustment → 创建审查任务', async () => {
    const mockAdjustment = {
      krId: 'kr-1',
      completedProjectId: 'proj-1',
      completedProjectName: 'Test',
      pendingCount: 1,
      adjustmentType: 'over_budget',
    };

    shouldAdjustPlan.mockResolvedValueOnce(mockAdjustment);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'")) {
        return { rows: [{ id: 'proj-1', name: 'Test Project', kr_id: 'kr-1' }] };
      }
      return { rows: [] };
    });

    await checkProjectCompletion(pool);

    expect(createPlanAdjustmentTask).toHaveBeenCalledWith(pool, {
      krId: 'kr-1',
      completedProjectId: 'proj-1',
      suggestion: mockAdjustment,
    });
  });

  it('shouldAdjustPlan 返回 null → 不创建审查任务', async () => {
    shouldAdjustPlan.mockResolvedValueOnce(null);

    pool.query = vi.fn(async (sql) => {
      if (sql.includes("p.type = 'project'") && sql.includes("p.status = 'active'")) {
        return { rows: [{ id: 'proj-1', name: 'Test', kr_id: 'kr-1' }] };
      }
      return { rows: [] };
    });

    await checkProjectCompletion(pool);

    expect(createPlanAdjustmentTask).not.toHaveBeenCalled();
  });
});
