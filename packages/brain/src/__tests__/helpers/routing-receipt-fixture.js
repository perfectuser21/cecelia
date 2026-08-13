export function routedCodingPayload(taskId, overrides = {}) {
  return {
    routing_receipt_id: `receipt-${taskId}`,
    work_kind: 'coding_mutation',
    change_kind: 'bugfix',
    repo: 'cecelia',
    orchestrator: 'skill-relay',
    harness_runtime: 'kernel-v1',
    ...overrides,
  };
}

export function canonicalRoutingReceipt(task) {
  return {
    id: task.payload.routing_receipt_id,
    task_id: task.id,
    superseded: false,
    router_version: ROUTER_VERSION,
    work_kind: 'coding_mutation',
    change_kind: task.payload.change_kind,
    repo: task.payload.repo,
    pipeline: 'harness',
    canonical_task_type: 'harness_initiative',
    impact_contract_required: true,
  };
}
import { ROUTER_VERSION } from '../../work-router.js';
