import { describe, it, expect } from 'vitest';

describe('Knife 0-2 路由合同与全入口清单', () => {
  it('四档正向映射且禁止 gear/stage/task type 反推 change_kind', async () => {
    const r = await import('../../../packages/brain/src/work-router.js');
    const profiles = { new_capability:'new-capability-v1', capability_change:'capability-change-v1', bugfix:'hotfix-v1', parameter_only:'parameter-only-v1' };
    for (const [change_kind, default_execution_profile] of Object.entries(profiles)) {
      expect(r.selectPipeline({ work_kind:'coding_mutation', change_kind })).toMatchObject({ pipeline:'harness', canonical_task_type:'harness_initiative', default_execution_profile });
    }
    expect(() => r.selectPipeline({ work_kind:'coding_mutation', gear:'hotfix' })).toThrow('change_kind_required');
  });

  it('冻结入口逐项覆盖并永久锁定三个既有陷阱', async () => {
    const { TASK_CREATION_INVENTORY, auditTaskCreationEntrypoints } = await import('../../../packages/brain/src/task-creation-inventory.js');
    expect(TASK_CREATION_INVENTORY).toHaveLength(33);
    expect(new Set(TASK_CREATION_INVENTORY.map((x:any) => x.module)).size).toBe(33);
    expect(await auditTaskCreationEntrypoints()).toMatchObject({ uncovered:[], direct_coding_dev:[], planner_missing_task_type:[], proposal_skill_as_task_type:[], capture_invalid_decision_columns:[] });
  });
});
