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

  it('harness_initiative 纳入引导范围，claude 不可用时续接到 codex', () => {
    const task = {
      id: 'task-4',
      task_type: 'harness_initiative',
      payload: { orchestrator: 'skill-relay' },
    };

    const res = applyDispatchAllocationGuide(task, {
      budgetState: 'abundant',
      llmCapacity: {
        sampled_at: '2026-07-21T10:00:00.000Z',
        sentinel: 'ok',
        vendors: {
          claude: { available_count: 0, total_count: 2, poller: 'ok' },
          codex: { available_count: 1, total_count: 2, poller: 'ok' },
          grok: { available_count: 1, total_count: 1, poller: 'ok' },
        },
      },
    });

    expect(res.task.payload.executor).toBe('codex');
    expect(res.task.payload.allocation).toEqual(expect.objectContaining({
      continuation_level: 'L3_cross_vendor_fallback',
      reason: 'primary_vendor_unavailable',
    }));
  });

  it('计费厂商都不可用时 grok 作为四级续接兜底', () => {
    const task = {
      id: 'task-5',
      task_type: 'harness_initiative',
      payload: { orchestrator: 'skill-relay' },
    };

    const res = applyDispatchAllocationGuide(task, {
      budgetState: 'tight',
      llmCapacity: {
        sampled_at: '2026-07-21T10:00:00.000Z',
        sentinel: 'degraded',
        vendors: {
          claude: { available_count: 0, total_count: 2, poller: 'ok' },
          codex: { available_count: 0, total_count: 2, poller: 'error' },
          grok: { available_count: 1, total_count: 1, poller: 'ok' },
        },
      },
    });

    expect(res.task.payload.executor).toBe('grok');
    expect(res.task.payload.allocation).toEqual(expect.objectContaining({
      continuation_level: 'L4_grok_fallback',
      reason: 'all_metered_vendors_unavailable',
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
