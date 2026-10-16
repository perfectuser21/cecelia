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
