import { describe, expect, it } from 'vitest';
import { selectPipeline } from '../../work-router.js';

describe('开发任务画像路由', () => {
  it.each(['new_capability', 'capability_change', 'bugfix', 'parameter_only'])('%s：有头记账与无头Runner分别路由', change_kind => {
    expect(selectPipeline({work_kind:'coding_mutation', change_kind, headed:true})).toMatchObject({
      canonical_task_type:'dev', orchestrator:'headed-session', impact_contract_required:true,
    });
    expect(selectPipeline({work_kind:'coding_mutation', change_kind})).toMatchObject({
      canonical_task_type:'coding_workflow', orchestrator:'coding-workflow-runner', impact_contract_required:false,
    });
  });
});
