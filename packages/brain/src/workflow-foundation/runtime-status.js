import {getRelease,getReleaseGate,lockReleaseTarget} from '../lib/release-index.js';
import {foundationTransaction,resolveFoundationRelease} from './registry.js';
import {UUID,onlyKeys,requireFoundation,validateFoundationRuntime,assertProfileComponent} from './contracts.js';

const matches=(a,b)=>['kind','repo','revision','path','digest'].every(key=>a[key]===b[key]);
function verifyComponents(fixed){
 const components=fixed.release.payload.components;
 assertProfileComponent(fixed.runtime,components);
 for(const row of [fixed.workflow,...fixed.release.payload.activities]){
  requireFoundation(components.some(c=>c.kind==='repo'&&c.repo===row.source_repo&&c.revision===row.source_commit),'foundation_source_component_missing');
  for(const binding of row.payload.implementation_bindings??[]){
   if(binding.kind==='raw'&&binding.status==='unresolved')continue;
   requireFoundation(binding.status==='verified'&&['code','skill'].includes(binding.kind)&&components.some(c=>matches(c,binding)),'foundation_binding_component_missing');
  }
 }
 for(const component of components.filter(c=>c.kind!=='repo')){
  requireFoundation(components.some(c=>c.kind==='repo'&&c.repo===component.repo&&c.revision===component.revision),'foundation_source_component_missing');
  requireFoundation(fixed.release.payload.activities.some(a=>(a.payload.implementation_bindings??[]).some(b=>b.status==='verified'&&matches(component,b))),'foundation_component_unbound');
 }
}

/** 只改变既有Foundation工作流状态；不派单、不更换定义或部署目标。 */
export async function setFoundationRuntimeStatus(pool,id,input){
 onlyKeys(input,['status','actor','task_id','reason','release_id','observation_id','workflow_definition_version_id','snapshot_sha256']);
 requireFoundation(UUID.test(id??'')&&UUID.test(input.task_id??''),'foundation_identity_invalid',400);
 requireFoundation(['active','paused'].includes(input.status),'foundation_status_invalid',400);
 requireFoundation(typeof input.actor==='string'&&input.actor.trim()===input.actor&&input.actor.length>0&&input.actor.length<=100&&typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=2000,'foundation_governance_invalid',400);
 if(input.status==='active')requireFoundation(UUID.test(input.release_id??'')&&UUID.test(input.observation_id??'')&&UUID.test(input.workflow_definition_version_id??'')&&/^[a-f0-9]{64}$/.test(input.snapshot_sha256??''),'foundation_release_identity_invalid',400);
 return foundationTransaction(pool,`foundation-runtime:${id}`,async db=>{
  const task=(await db.query('SELECT * FROM tasks WHERE id=$1 FOR SHARE',[input.task_id])).rows[0];
  requireFoundation(task?.status==='in_progress'&&task.claimed_by===input.actor&&task.payload?.actor===input.actor&&Array.isArray(task.payload.workflow_runtime_scope)&&task.payload.workflow_runtime_scope.includes(id),'foundation_governance_denied',403);
  const lease=(await db.query(`SELECT l.task_id FROM task_leases l JOIN tasks t ON t.id=l.task_id
   WHERE l.task_id=$1 AND l.claimer=$2 AND l.claimed_at=t.claimed_at AND l.released_at IS NULL AND l.lease_until>clock_timestamp() FOR SHARE OF l`,[input.task_id,input.actor])).rows[0];
  requireFoundation(lease,'foundation_governance_lease_expired',403);
  const row=(await db.query('SELECT * FROM workflows WHERE id=$1 FOR UPDATE',[id])).rows[0];
  requireFoundation(row&&['active','paused'].includes(row.status),'foundation_workflow_not_mutable');
  const current=(await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1 AND workflow_id=$2',[row.current_definition_version_id,id])).rows[0];
  requireFoundation(current&&current.payload.definition_scope!=='consumer_evidence','foundation_current_definition_missing');
  // 停用也只能用于Foundation；故障停用不依赖当前部署仍健康。
  validateFoundationRuntime(current.payload.contract?.runtime);
  if(input.status==='active'){
   const release=await getRelease(db,input.release_id);
   requireFoundation(release.environment==='production','foundation_release_not_production');
   await lockReleaseTarget(db,release.environment,release.target);
   const fixed=await resolveFoundationRelease(db,{workflow_id:id,release_id:input.release_id},{allowPaused:true});
   const gate=await getReleaseGate(db,input.release_id);
   requireFoundation(gate.deployed===true&&gate.actual_matches===true&&Array.isArray(gate.gaps)&&gate.gaps.length===0&&gate.current_observation_id===input.observation_id,'foundation_release_observation_mismatch');
   requireFoundation(fixed.workflow.id===current.id&&current.id===input.workflow_definition_version_id&&fixed.workflow.payload_sha256===current.payload_sha256&&current.payload_sha256===input.snapshot_sha256&&fixed.workflow.source_repo===row.source_repo&&fixed.workflow.source_repo===current.source_repo&&fixed.workflow.source_commit===current.source_commit,'foundation_current_definition_mismatch');
   verifyComponents(fixed);
  }
  // 等锁期间租约可能到期；更新前再次以数据库时钟确认，不能借事务起始时间续命。
  requireFoundation((await db.query('SELECT task_id FROM task_leases WHERE task_id=$1 AND released_at IS NULL AND lease_until>clock_timestamp()',[input.task_id])).rows.length===1,'foundation_governance_lease_expired',403);
  await db.query('UPDATE workflows SET status=$2,updated_at=NOW() WHERE id=$1',[id,input.status]);
  await db.query("INSERT INTO task_events(task_id,event_type,payload) VALUES($1,'foundation_runtime_status_changed',$2)",[input.task_id,{...input,workflow_id:id,prior_status:row.status}]);
  const workflow=(await db.query('SELECT * FROM workflows WHERE id=$1',[id])).rows[0];
  requireFoundation(workflow?.status===input.status&&workflow.current_definition_version_id===row.current_definition_version_id,'foundation_runtime_status_readback_failed');
  return {workflow};
 });
}
