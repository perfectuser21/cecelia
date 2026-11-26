import { describe, expect, it } from 'vitest';
import { selectPipeline } from '../../work-router.js';

describe('开发任务画像路由', () => {
  it.each([
    ['new_capability', 'new-capability-v1'],
    ['capability_change', 'capability-change-v1'],
    ['bugfix', 'hotfix-v1'],
    ['parameter_only', 'parameter-only-v1'],
  ])('%s：保留画像%s，有头记账与无头Agent分别路由', (change_kind, profile) => {
    expect(selectPipeline({work_kind:'coding_mutation', change_kind, headed:true})).toMatchObject({
      change_kind, default_execution_profile:profile, execution_profile_override:null,
      pipeline:'headed_development', canonical_task_type:'dev', orchestrator:'headed-session', impact_contract_required:true,
    });
    expect(selectPipeline({work_kind:'coding_mutation', change_kind})).toMatchObject({
      change_kind, default_execution_profile:profile, execution_profile_override:null,
      pipeline:'agent_development', canonical_task_type:'codex_dev', orchestrator:'codex-bridge', impact_contract_required:false,
    });
  });
});
