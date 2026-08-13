import { randomUUID } from 'node:crypto';
import { createKernelRun } from '../../../orchestrator/kernel-run-store.js';

export async function seedRoutedKernelTask(pool, {
  titlePrefix,
  initiativeId = randomUUID(),
  taskId = randomUUID(),
  changeKind = 'bugfix',
  payload = {},
}) {
  const receiptId = randomUUID();
  const defaultExecutionProfile = ({
    new_capability: 'new-capability-v1',
    capability_change: 'capability-change-v1',
    bugfix: 'hotfix-v1',
    parameter_only: 'parameter-only-v1',
  })[changeKind];
  const routedPayload = {
    ...payload,
    initiative_id: initiativeId,
    routing_receipt_id: receiptId,
    work_kind: 'coding_mutation',
    change_kind: changeKind,
    repo: 'cecelia',
    map_scope: ['F0'],
    default_execution_profile: defaultExecutionProfile,
    impact_contract_required: true,
    orchestrator: 'skill-relay',
    harness_runtime: 'kernel-v1',
  };
  await pool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `${titlePrefix}-${taskId}`, JSON.stringify(routedPayload)],
  );
  await pool.query(
    `INSERT INTO work_routing_receipts (
       id, task_id, source, source_id, work_kind, change_kind, pipeline,
       canonical_task_type, default_execution_profile, repo, map_scope,
       impact_contract_required, orchestrator, router_version, route_reason, evidence
     ) VALUES (
       $1, $2, 'integration', $3, 'coding_mutation', $4, 'harness',
       'harness_initiative', $5, 'cecelia', '["F0"]'::jsonb,
       true, 'kernel-harness-v2', 'work-router-v1', 'integration_fixture', $6::jsonb
     )`,
    [
      receiptId,
      taskId,
      `${titlePrefix}:${taskId}`,
      changeKind,
      defaultExecutionProfile,
      JSON.stringify({
        branch: `cp-${titlePrefix}-${taskId.slice(0, 8)}`,
        base_sha: 'a'.repeat(40),
      }),
    ],
  );
  return { initiativeId, taskId, receiptId, payload: routedPayload };
}

export function createRoutedKernelRun(pool, input) {
  const serverOwnedInput = { ...input };
  delete serverOwnedInput.controllerSessionId;
  return createKernelRun(pool, serverOwnedInput, {
    ensureMapImpactPreflight: async () => ({
      contract: { id: randomUUID(), status: 'active' },
      recovery_contract: null,
    }),
  });
}
