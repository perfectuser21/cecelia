import { describe, expect, it, vi } from 'vitest';
import { triggerCompletedDecompositionReview } from '../decomposition-review-trigger.js';

describe('拆解完成回调只消费 projects 和直接子任务', () => {
  function makePool(task = { task_type: 'dev', payload: { decomposition: 'true' }, goal_id: 'kr', project_id: 'project' }, children = [{ title: '实现任务' }]) {
    return { query: vi.fn(async sql => {
      expect(sql).not.toMatch(/okr_(projects|scopes|initiatives)/);
      if (sql.includes('FROM tasks WHERE id')) return { rows: [task] };
      if (sql.includes('FROM key_results')) return { rows: [{ id: 'kr', title: '目标', status: 'decomposing' }] };
      if (sql.includes('FROM projects')) return { rows: [{ id: 'project', name: '新项目' }] };
      if (sql.includes('FROM tasks WHERE project_id')) return { rows: children };
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
    const pool = makePool(undefined, []);
    const createReview = vi.fn();
    await triggerCompletedDecompositionReview(pool, 'completed-task', { shouldReview: vi.fn(async () => false), createReview });
    expect(createReview).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO pending_actions'))).toBe(false);
  });
  it('已有审查的重试仍补齐确认门与 KR 状态，且不重复派审查任务', async () => {
    const pool = makePool();
    const createReview = vi.fn();
    await triggerCompletedDecompositionReview(pool, 'completed-task', { shouldReview: vi.fn(async () => false), createReview });
    expect(createReview).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO pending_actions'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes("status = 'reviewing'"))).toBe(true);
  });
  it('修正拆解可从 reviewing 再送审，兼容旧 entity_id 且不选同 KR 的别项目', async () => {
    const pool = makePool({ task_type: 'project_plan', goal_id: 'kr', payload: {
      decomposition: 'true', revision: true, entity_type: 'project', entity_id: 'revised-project',
    } });
    const delegate = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, args) => {
      if (sql.includes('FROM key_results')) {
        return { rows: args[2] === true ? [{ id: 'kr', title: '目标', status: 'reviewing' }] : [] };
      }
      if (sql.includes('FROM projects')) {
        expect(args[1]).toBe('revised-project');
        return { rows: [{ id: args[1], name: '修正项目' }] };
      }
      return delegate(sql, args);
    });
    const createReview = vi.fn(async () => ({ task: { id: 'second-review' } }));
    expect(await triggerCompletedDecompositionReview(pool, 'revision-task', {
      shouldReview: vi.fn(async () => true), createReview,
    })).toMatchObject({ reviewed: true, project_id: 'revised-project' });
    expect(createReview).toHaveBeenCalledWith(pool, expect.objectContaining({ entityId: 'revised-project' }));
  });
  it('复用确认门时刷新当前项目和修正后的任务上下文', async () => {
    const pool = makePool();
    const delegate = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, args) => {
      if (sql.includes('SELECT id FROM pending_actions')) return { rows: [{ id: 'old-confirmation' }] };
      return delegate(sql, args);
    });
    await triggerCompletedDecompositionReview(pool, 'revision-task', {
      shouldReview: vi.fn(async () => false), createReview: vi.fn(),
    });
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE pending_actions'));
    expect(update).toBeDefined();
    expect(JSON.parse(update[1][1])).toMatchObject({ project_name: '新项目', tasks: ['实现任务'] });
    expect(update[1][2]).toBe('old-confirmation');
  });

  it('首次复用项目优先本棒 result 中选定 Project，避免误审同 KR 最新项目', async () => {
    const pool = makePool({ task_type: 'dev', goal_id: 'kr', payload: { decomposition: 'true' },
      result: { decomposition_project_id: 'chosen-old-project' } });
    const delegate = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, args) => {
      if (sql.includes('FROM projects')) {
        expect(args[1]).toBe('chosen-old-project');
        return { rows: [{ id: args[1], name: '已选择项目' }] };
      }
      return delegate(sql, args);
    });
    expect(await triggerCompletedDecompositionReview(pool, 'first-decomp', {
      shouldReview: vi.fn(async () => true), createReview: vi.fn(async () => ({})),
    })).toMatchObject({ project_id: 'chosen-old-project' });
  });

  it('无显式项目且同 KR 多项目时拒绝猜选最新项目', async () => {
    const pool = makePool({ task_type: 'dev', goal_id: 'kr', payload: { decomposition: 'true' } });
    const delegate = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, args) => {
      if (sql.includes('FROM projects')) return { rows: [{ id: 'first' }, { id: 'second' }] };
      return delegate(sql, args);
    });
    const createReview = vi.fn();
    expect(await triggerCompletedDecompositionReview(pool, 'unbound-decomp', {
      shouldReview: vi.fn(async () => true), createReview,
    })).toMatchObject({ skipped: true, reason: 'ambiguous_project' });
    expect(createReview).not.toHaveBeenCalled();
  });

});
