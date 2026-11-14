export function routedCodingPayload(taskId, overrides = {}) {
  return {
    routing_receipt_id: `receipt-${taskId}`,
    work_kind: 'coding_mutation',
    change_kind: 'bugfix',
    repo: 'cecelia',
    orchestrator: 'headed-session',
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
    pipeline: task.task_type === 'coding_workflow' ? 'coding_workflow' : 'headed_development',
    canonical_task_type: task.task_type,
    orchestrator: task.task_type === 'coding_workflow' ? 'coding-workflow-runner' : 'headed-session',
    impact_contract_required: task.task_type !== 'coding_workflow',
    map_scope_validation_version: 'active-business-node-v1',
  };
}
import { ROUTER_VERSION } from '../../work-router.js';
