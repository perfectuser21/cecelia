import {assertRouteSnapshotLaunchAuthority} from '../orchestrator/route-snapshot-authority.js';
import {isRetiredDevelopmentTask} from './task-type-registry.js';

export function assertDispatchRoutingReceipt(task, receipt, {hasV2Run=false}={}) {
  if(isRetiredDevelopmentTask(task))throw Error('route_violation');
  const coding=task?.task_type==='dev'||task?.task_type==='coding_workflow'||task?.payload?.work_kind==='coding_mutation';
  if(!coding)return true;
  const headed=task.task_type==='dev';
  if(!receipt || receipt.id!==task.payload?.routing_receipt_id || receipt.task_id!==task.id
    || receipt.superseded===true || receipt.router_version!=='work-router-v1'
    || receipt.work_kind!=='coding_mutation'
    || receipt.canonical_task_type!==task.task_type
    || receipt.pipeline!==(headed?'headed_development':'coding_workflow')
    || receipt.orchestrator!==(headed?'headed-session':'coding-workflow-runner')
    || receipt.change_kind!==task.payload?.change_kind || receipt.repo!==task.payload?.repo
    || receipt.impact_contract_required!==headed)throw Error('route_violation');
  try{assertRouteSnapshotLaunchAuthority({taskStatus:task.status,validationVersion:receipt.map_scope_validation_version,hasV2Run});}
  catch{throw Error('route_violation');}
  return true;
}
