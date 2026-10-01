import { describe, expect, it, vi } from 'vitest';
import { triggerCompletedDecompositionReview } from '../decomposition-review-trigger.js';

describe('拆解完成回调只消费 projects 和直接子任务', () => {
  function makePool(task = { task_type: 'dev', payload: { decomposition: 'true' }, goal_id: 'kr', project_id: 'project' }) {
    return { query: vi.fn(async sql => {
      expect(sql).not.toMatch(/okr_(projects|scopes|initiatives)/);
      if (sql.includes('FROM tasks WHERE id')) return { rows: [task] };
      if (sql.includes('FROM key_results')) return { rows: [{ id: 'kr', title: '目标', status: 'decomposing' }] };
      if (sql.includes('FROM projects')) return { rows: [{ id: 'project', name: '新项目' }] };
      if (sql.includes('FROM tasks WHERE project_id')) return { rows: [{ title: '实现任务' }] };
      return { rows: [] };
    }) };
  }

  it('新项目有拆解 Task 时触发审查并登记真实 Task 确认上下文', async () => {
    const pool = makePool();
    const createReview = vi.fn(async () => ({ task: { id: 'review-task' } }));
    await triggerCompletedDecompositionReview(pool, 'completed-task', { shouldReview: vi.fn(async () => true), createReview });
    expect(createReview).toHaveBeenCalledWith(pool, expect.objectContaining({ entityId: 'project', entityType: 'project' }));
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO pending_actions'));
    expect(JSON.parse(insert[1][1])).toMatchObject({ project_name: '新项目', tasks: ['实现任务'] });
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("status = 'reviewing'"))).toBe(true);
  });

  it('非拆解任务不触发确认门或项目状态更新', async () => {
    const pool = makePool({ task_type: 'dev', payload: {}, goal_id: 'kr' });
    expect(await triggerCompletedDecompositionReview(pool, 'ordinary-task')).toMatchObject({ skipped: true });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('项目无直接任务时不创建空确认门', async () => {
    const pool = makePool();
    const createReview = vi.fn();
    await triggerCompletedDecompositionReview(pool, 'completed-task', { shouldReview: vi.fn(async () => false), createReview });
    expect(createReview).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO pending_actions'))).toBe(false);
  });
});
