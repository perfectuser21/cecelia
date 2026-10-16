import { definitionDigest,requireCondition,text } from '../workflow-authoring/contracts.js';

/** 新活动尚无树实体；候选身份只由服务器固定管理任务、定义和slot确定。 */
export function candidateSlotTarget({authoringTaskId,composeSha256,slotKey,tenantId}) {
  text(slotKey,'slot_key',128);
  const hash=definitionDigest({protocol:'candidate-slot-v1',authoringTaskId,composeSha256,slotKey,tenantId});
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return {kind:'activity',id,slot_key:slotKey,definition_version_id:`candidate:${composeSha256}`};
}
export function canonicalCandidateTarget(body,tenantId) {
  if(body.mode!=='candidate')return body.target;
  if(body.target?.kind==='activity'&&body.target.slot_key!==undefined){
    const target=candidateSlotTarget({authoringTaskId:body.authoring_task_id,composeSha256:body.compose_sha256,slotKey:body.target.slot_key,tenantId});
    requireCondition([body.authoring_task_id,target.id].includes(body.target.id),'候选slot身份不匹配',409);
    requireCondition(!body.target.definition_version_id||body.target.definition_version_id===target.definition_version_id,'候选版本身份不匹配',409);
    return target;
  }
  return {...body.target,definition_version_id:body.target.definition_version_id??`candidate:${body.compose_sha256}`};
}
/** 目录别名必须先由真实冻结owner证明，随后只保留服务器候选身份。 */
export function canonicalOwnerTarget(body,tenantId,owner){
 if(body.target.kind==='workflow'){
  requireCondition([owner.workflow_id,owner.authoring_task_id].includes(body.target.id),'候选目标身份不匹配',409);
  const target={kind:'workflow',id:owner.authoring_task_id,definition_version_id:`candidate:${body.compose_sha256}`};
  requireCondition(!body.target.definition_version_id||body.target.definition_version_id===target.definition_version_id,'候选版本身份不匹配',409);return target;
 }
 const slots=owner.slots.filter(s=>body.target.slot_key!==undefined?s.slot_key===body.target.slot_key:
  s.activity_id===body.target.id||candidateSlotTarget({authoringTaskId:owner.authoring_task_id,composeSha256:body.compose_sha256,slotKey:s.slot_key,tenantId}).id===body.target.id);
 requireCondition(slots.length===1,'candidate_slot_ambiguous',409);
 const target=candidateSlotTarget({authoringTaskId:owner.authoring_task_id,composeSha256:body.compose_sha256,slotKey:slots[0].slot_key,tenantId});
 requireCondition([target.id,slots[0].activity_id,owner.authoring_task_id].includes(body.target.id),'候选slot身份不匹配',409);
 requireCondition(!body.target.definition_version_id||body.target.definition_version_id===target.definition_version_id,'候选版本身份不匹配',409);return target;
}
export async function canonicalInvocationTarget(db,body,tenantId){
 if(body.mode!=='candidate')return body.target;
 const row=(await db.query('SELECT id,tenant_id,payload,result FROM tasks WHERE id=$1',[body.authoring_task_id])).rows[0];
 const {EXECUTION_PROTOCOL,readCandidateOwner}=await import('../workflow-authoring/assembly-orchestration.js');
 if(row?.result?.workflow_authoring?.request?.execution_protocol!==EXECUTION_PROTOCOL)return canonicalCandidateTarget(body,tenantId);
 requireCondition((row.payload?.tenant_id??'default')===tenantId&&(!row.tenant_id||row.tenant_id===tenantId),'管理任务不存在',404);
 const definition=row.result.workflow_authoring.outputs?.compose?.definition;
 requireCondition(definition&&definitionDigest(definition)===body.compose_sha256,'候选组装摘要已变化',409);
 const owner=await readCandidateOwner(db,row.id,definition,tenantId);requireCondition(owner,'candidate_owner_missing',409);
 return canonicalOwnerTarget(body,tenantId,owner);
}
