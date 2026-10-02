import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {requestHash,validateReceipt} from '../node-onboarding/spec.js';
import {error} from './deployment.js';
const MISSING_ANCHOR='S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火';
const deny=()=>{throw error('linux_pool_retry_unconfirmed');};
/** 只接续有正式误收证据的旧控制任务；不复活failed，不从外部请求导入状态。 */
export async function prepareFailedControllerRetry(db,task,source,machine,revision){
 const s=task?.payload?.linux_onboarding,meta=source?.payload?.node_onboarding;
 if(!s||task.status!=='failed'||task.task_type!=='audit'||task.claimed_by!==null
  ||task.created_by!=='linux-pool-onboarding'||task.error_message!==MISSING_ANCHOR
  ||s.phase!=='script_prepare'||s.revoked===true||meta?.execution_revoked===true
  ||meta?.execution_task_id!==task.id||meta?.id!==machine.id||meta?.mode!=='enroll'||meta?.reconciled!==true
  ||source.status!=='completed'||!source.completed_at||s.parent_task_id!==source.id
  ||requestHash(meta.request)!==s.request_hash||meta.request.role!=='worker'||meta.request.name!==machine.name
  ||machine.metadata?.onboarding?.execution_task_id!==task.id||!/^[a-f0-9]{40}$/.test(revision??''))deny();
 try{if(validateReceipt(source,source.completed_at).health.os!=='linux')deny();}catch{deny();}
 const route=await db.query("SELECT 1 FROM work_routing_receipts WHERE task_id=$1 AND source='scheduler' AND source_id=$2 AND canonical_task_type='audit'",[task.id,'linux-pool-onboarding:'+s.nonce]);
 const event=await db.query(`SELECT 1 FROM task_events WHERE task_id=$1 AND event_type='watchdog_safe_requeue'
  AND payload->>'reason'='no_spawn_evidence' AND payload->>'headed_manual'='false'
  AND payload->'evidence'='{"active_process":false,"process_log":false,"dispatch_receipt":false}'::jsonb`,[task.id]);
 if(!route.rowCount||!event.rowCount)deny();
 await db.query(MACHINE_CAPACITY_LOCK_SQL,[machine.name]);
 if((await db.query("SELECT id FROM capacity_reservations WHERE machine_id=$1 AND status<>'released' LIMIT 1",[machine.name])).rowCount)deny();
 const node=(await db.query('SELECT current_version_id FROM execution_nodes WHERE machine_registry_id=$1',[machine.id])).rows[0];
 if((node?.current_version_id??null)!==s.expected_version_id)deny();
 if((await db.query(`SELECT g.id FROM execution_grants g JOIN execution_node_versions v ON v.id=g.node_version_id
  WHERE v.machine_registry_id=$1 AND g.surface='managed_script' AND g.state='active' LIMIT 1`,[machine.id])).rowCount)deny();
 const runtimes=(await db.query(`SELECT a.id,a.state,t.status,t.payload,t.result FROM linux_script_authorizations a
  LEFT JOIN tasks t ON t.id=a.evidence_task_id WHERE a.machine_registry_id=$1`,[machine.id])).rows;
 if(runtimes.some(r=>r.state!=='revoked'||r.status!=='archived'||r.payload?.linux_runtime_revoked===true
  ||r.payload?.linux_runtime_retired!==r.id||r.result?.actor!=='linux-pool-onboarding'
  ||r.result?.evidence?.receipt?.cleanup_confirmed!==true))deny();
 // 仅复制原凭据缓存与策略CAS；新程序/nonce/intent均由当前服务生成，旧产物及失败证据不改。
 return {machine_registry_id:machine.id,onboarding_id:s.onboarding_id,parent_task_id:source.id,
  phase:'probe',request_hash:s.request_hash,nonce:randomBytes(32).toString('hex'),intent_id:randomUUID(),revision,
  expected_version_id:s.expected_version_id,resume_of_task_id:task.id,
  ...(s.policy_json?{policy_json:s.policy_json}:{}),
  ...(s.credentials?{credentials:s.credentials}:{}),...(s.credential_files?{credential_files:s.credential_files}:{}),
  ...(s.pool_policy_digest?{pool_policy_digest:s.pool_policy_digest}:{}),...(s.runtime_policy_digest?{runtime_policy_digest:s.runtime_policy_digest}:{})};
}
