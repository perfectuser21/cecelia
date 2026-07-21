import { describe, it, expect } from 'vitest';
import { applyDispatchAllocationGuide, DISPATCH_ALLOCATION_GUIDE_VERSION } from '../dispatch-allocation-guide.js';

describe('dispatch-allocation-guide', () => {
  it('budget_state=tight 的 dev 任务 → 写 payload.executor=codex + allocation 账本', () => {
    const task = {
      id: 'task-1',
      task_type: 'dev',
      payload: {},
    };

    const res = applyDispatchAllocationGuide(task, {
      budgetState: 'tight',
      now: () => new Date('2026-07-21T10:00:00.000Z'),
    });

    expect(res.changed).toBe(true);
    expect(res.task.payload.executor).toBe('codex');
    expect(res.task.payload.allocation).toEqual(expect.objectContaining({
      selector: DISPATCH_ALLOCATION_GUIDE_VERSION,
      selected_executor: 'codex',
      budget_state: 'tight',
      reason: 'budget_state=tight',
      decided_at: '2026-07-21T10:00:00.000Z',
    }));
  });

  it('budget_state=abundant 的 dev 任务 → 保持 claude 默认路由，仅写 allocation 账本', () => {
    const task = {
      id: 'task-2',
      task_type: 'dev',
      payload: {},
    };

    const res = applyDispatchAllocationGuide(task, { budgetState: 'abundant' });

    expect(res.changed).toBe(true);
    expect(res.task.payload.executor).toBeUndefined();
    expect(res.task.payload.allocation).toEqual(expect.objectContaining({
      selected_executor: 'claude',
      budget_state: 'abundant',
      reason: 'default_claude',
    }));
  });

  it('已有显式 executor 时不覆盖', () => {
    const task = {
      id: 'task-3',
      task_type: 'dev',
      payload: { executor: 'claude' },
    };

    const res = applyDispatchAllocationGuide(task, { budgetState: 'tight' });

    expect(res.changed).toBe(false);
    expect(res.reason).toBe('explicit_override_preserved');
    expect(res.task).toBe(task);
  });
});
