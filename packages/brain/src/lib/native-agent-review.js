import {transaction} from '../execution-directory/store.js';
import {assertOwnerDecisionProtocol,openOwnerDecisionPendingAction} from './owner-decision.js';
export function nativeHasResources(binding){
 return Boolean(binding.device_locks?.length||binding.resources?.device_serial||binding.resources?.requested_device);
}
export function nativeAssistantText(stdout){
 let last='';
 for(const line of String(stdout??'').split('\n')){
  try{const event=JSON.parse(line);if(event.type==='item.completed'&&event.item?.type==='agent_message'&&typeof event.item.text==='string')last=event.item.text;}catch{}
 }
 return last;
}
export async function holdNativeReview(pool,task,binding,_receipt){
 const detail={question:`原生运行 ${binding.request.run_id} 已停止本机进程，但设备/账号外部动作与清理尚未独立确认，请核查原运行证据。`,
  options:['A 保持隔离并核查原设备与外部效果','B 已核查后另行登记明确的清理工作'],default:'A',deadline:new Date(Date.now()+86400000).toISOString(),reversible:false,waiting_on:'human',run_id:binding.request.run_id};
 assertOwnerDecisionProtocol({reason:'owner_decision',detail});
 return transaction(pool,async db=>{
  const changed=await db.query(`UPDATE tasks SET status='blocked',blocked_reason='owner_decision',blocked_at=NOW(),blocked_until=$3,
   blocked_detail=$2::jsonb,payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{owner_decision}',$2::jsonb,true),
   result=jsonb_set(COALESCE(result,'{}'::jsonb),'{native_agent,needs_review}','true'::jsonb,true),
   error_message='native_agent_external_cleanup_unconfirmed',updated_at=NOW()
   WHERE id=$1 AND status='in_progress' AND result->'native_agent'->'request'->>'run_id'=$4 RETURNING *`,[task.id,JSON.stringify(detail),detail.deadline,binding.request.run_id]);
  if(changed.rowCount===1)await openOwnerDecisionPendingAction(db,{taskId:task.id,title:task.title,detail});
  return {success:false,taskTerminal:true,needs_review:true,reason:'native_agent_external_cleanup_unconfirmed',runId:binding.request.run_id};
 });
}
