import {activityStatus,activityRoute} from '../orchestrator/activity-judgment.js';
/** 与持久执行器同一判据；中央收账另核冻结顺序，允许合同显式stop。 */
function accepted(receipt,key){
 const a=receipt?.activities?.[0];
 return receipt?.scope==='activity'&&receipt.activity_key===key&&!receipt.reason_code&&!receipt.event_failures?.length
  &&receipt.status!=='needs_review'&&receipt.execution_unknown!==true&&receipt.activities.length===1&&a.key===key
  &&a.validator_verdict?.verdict==='pass'&&a.attempts?.length===1&&a.attempts.every(x=>['completed','empty'].includes(x.status)
   &&x.external_effect!=='unknown'&&x.execution_stopped!==false&&x.adapter_result?.execution_stopped!==false);
}
export function verifiedFoundationReceipts(contract,result){
 if(!Array.isArray(result.receipts)||!result.receipts.length)return false;
 let i=0,stopped=false;
 for(const activity of contract.activities){
  if(activity.runtime.phase==='source'&&stopped)continue;
  const receipt=result.receipts[i++];if(!accepted(receipt,activity.key))return false;
  if(activity.runtime.phase==='finalize'){if(result.cleanup_status!=='completed')return false;continue;}
  const attempt=receipt.activities[0].attempts[0],route=activityRoute(contract,activity,activityStatus(attempt),attempt,true);
  if(route==='stop')stopped=true;else if(route!=='next')return false;
 }
 return i===result.receipts.length;
}
