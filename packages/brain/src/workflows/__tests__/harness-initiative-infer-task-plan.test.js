import { describe, it, expect, vi } from 'vitest';
import { inferTaskPlanNode } from '../harness-initiative.graph.js';

describe('inferTaskPlanNode catch 行为 [BEHAVIOR]', () => {
  it('git show 失败时应返回 { error: ... } 让 graph 走 error → END', async () => {
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-DOESNOTEXIST00000' },
      worktreePath: '/Users/administrator/perfect21/cecelia',
      initiativeId: 'test-init',
    };
    const delta = await inferTaskPlanNode(state);
    expect(delta).toHaveProperty('error');
    expect(String(delta.error)).toMatch(/git show origin/i);
  });

  it('已有非空 taskPlan.tasks 时应 passthrough（幂等）', async () => {
    const state = {
      taskPlan: { tasks: [{ task_id: 'ws1' }] },
      ganResult: { propose_branch: 'whatever' },
      worktreePath: '/tmp',
    };
    const delta = await inferTaskPlanNode(state);
    expect(delta).toEqual({});
  });
});
