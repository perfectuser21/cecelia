import { getRelease, getReleaseGate } from '../lib/release-index.js';
import { digest } from '../orchestrator/commander-decision.js';
import { UUID, onlyKeys, requireFoundation } from './contracts.js';

export async function resolveStandaloneRelease(db, { workflow_id, release_id }, workflowKey) {
  requireFoundation(UUID.test(workflow_id ?? '') && UUID.test(release_id ?? ''), 'foundation_identity_invalid', 400);
  const row = (await db.query('SELECT id,key,name,status FROM workflows WHERE id=$1', [workflow_id])).rows[0];
  requireFoundation(row && row.key === workflowKey, 'foundation_notion_workflow_invalid', 400);
  requireFoundation(row.status === 'active', 'foundation_workflow_not_active');
  const release = await getRelease(db, release_id);
  requireFoundation(release.target === 'mmv', 'standalone_release_target_invalid');
  const workflow = release.payload.workflows.find(item => item.workflow_id === workflow_id);
  requireFoundation(workflow?.payload?.key === row.key, 'foundation_release_workflow_missing');
  const gate = await getReleaseGate(db, release_id);
  requireFoundation(gate.deployed && gate.actual_matches && gate.current_observation_id && gate.gaps?.length === 0,
    'foundation_release_not_ready');

  const expected_path = workflow.payload.activities.flatMap(ref => {
    const activity = release.payload.activities.find(item => item.id === ref.activity_version_id && item.activity_id === ref.activity_id);
    requireFoundation(activity, 'foundation_activity_version_missing');
    const entry = {reference_id:ref.reference_id, activity_id:ref.activity_id, activity_definition_version_id:activity.id, required:true};
    return [entry, ...(activity.payload.steps ?? []).filter(step => step.step_id).map(step => ({ ...entry, step_id:step.step_id }))];
  });
  return {
    row, machine_id: 'us-mac-m4',
    definition: {
      release_id, workflow_id, observation_id:gate.current_observation_id, workflow_definition_version_id:workflow.id,
      snapshot_sha256:workflow.payload_sha256, runtime_snapshot_sha256:digest({release_id, workflow_version_id:workflow.id}), expected_path,
    },
  };
}

export function validateStandaloneInput(input, stage) {
  onlyKeys(input, ['binding_key','business']);
  requireFoundation(/^[A-Za-z0-9_-]{1,100}$/.test(input.binding_key ?? ''), 'notion_leadgen_input_invalid', 400);
  if (stage !== '101') {
    const field = stage === '104' ? 'order_id' : 'source_run';
    onlyKeys(input.business, [field]);
    const value = input.business[field];
    const valid = field === 'order_id' ? UUID.test(value ?? '') || /^rec[A-Za-z0-9]{1,50}$/.test(value ?? '')
      : /^[A-Za-z0-9_-]{1,120}$/.test(value ?? '');
    requireFoundation(typeof value === 'string' && valid, 'notion_leadgen_input_invalid', 400);
    return;
  }
  onlyKeys(input.business, ['keyword','max_candidates']);
  const keyword = input.business.keyword;
  requireFoundation(typeof keyword === 'string' && keyword.trim() === keyword && keyword.length > 0 && keyword.length <= 80
    && !/[\r\n\0]/.test(keyword) && input.business.max_candidates === 1, 'notion_leadgen_input_invalid', 400);
}
