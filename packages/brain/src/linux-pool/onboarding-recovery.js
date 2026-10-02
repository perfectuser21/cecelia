import {createDeploymentReader,error} from './deployment.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
import {verifyCanaryEnvelope} from './receipt.js';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {internallyRetiredPool} from './onboarding-revocation.js';
import {verifyCleanupEnvelope} from './cleanup-receipt.js';
/** 过期证明只能证明旧canary已清理，绝不能激活或延长许可。未知回执继续原nonce。 */
export function createOnboardingRecovery({pool,poolAuthorization,runtimeAuthorization,readPool=createDeploymentReader(),readRuntime=createRuntimeDeploymentReader(),afterTerminal=afterTerminalTransition}={}){
 return async(kind,machineId,state,envelope)=>{
  const script=kind==='script',id=script?JSON.parse(state.runtime_json).id:state.challenge.id;
  const row=(await pool.query(script?'SELECT *,clock_timestamp() AS db_now FROM linux_script_authorizations WHERE id=$1 AND machine_registry_id=$2':
   `SELECT c.*,clock_timestamp() AS db_now,a.state AS attestation_state,a.expires_at AS attestation_expires_at FROM linux_pool_challenges c
    LEFT JOIN linux_pool_attestations a ON a.challenge_id=c.id WHERE c.id=$1 AND c.machine_registry_id=$2`,[id,machineId])).rows[0];
  if(!row)throw error('linux_pool_stage_unconfirmed');
  if(script){const flags=(await pool.query('SELECT payload FROM tasks WHERE id=$1',[row.evidence_task_id])).rows[0]?.payload;
   if(flags?.linux_runtime_revoked===true||row.state==='revoked'&&flags?.linux_runtime_retired!==row.id)throw error('linux_pool_explicitly_revoked');}
  else if(row.state==='revoked'&&!await internallyRetiredPool(pool,row.id,machineId))throw error('linux_pool_explicitly_revoked');
  const committed=script&&row.signed_payload!==null&&row.signed_payload!==undefined;
  const cleanupOnly=envelope?.receipt?.schema_version===`linux-${script?'script':'pool'}-canary-cleanup/v1`;
  if(script?row.state==='active'&&new Date(row.authorization_expires_at)>new Date(row.db_now):row.attestation_state==='ready')return false;
  const deadline=script?row.challenge_expires_at:row.attestation_expires_at??row.expires_at;
  // 证明本身5分钟freshness也可能先过期。安全恢复依然必须完整验签输出和精确墓碑。
  const completed=Date.parse(envelope?.receipt?.completed_at),now=new Date(row.db_now).getTime();
  if(!cleanupOnly&&!committed&&new Date(deadline).getTime()>now&&Number.isFinite(completed)&&now-completed<=300000)return false;
  const deployment=await (script?readRuntime:readPool)(machineId);
  if(row.policy_digest!==deployment.policyDigest||!Number.isFinite(completed)||completed>now+1000)throw error('linux_pool_stage_unconfirmed');
  const verified=cleanupOnly?verifyCleanupEnvelope(kind,envelope,row,deployment,now):(script?verifyRuntimeEnvelope:verifyCanaryEnvelope)(envelope,row,deployment,completed);
  if(committed&&(verified.raw!==row.signed_payload||verified.signature!==row.signature))throw error('linux_pool_runtime_receipt_invalid');
  if(script){
   await runtimeAuthorization.retire(machineId,{runtime_id:id,expected_version_id:committed?row.execution_version_id:state.expected_version_id});
   const closed=await finalizeTask(pool,row.evidence_task_id,'archived',{relay:false,onlyIfStatus:['in_progress'],where:{sql:'claimed_by=$1',params:['linux-script-canary:'+id]},
    mergeResult:{actor:'linux-pool-onboarding',fact:'旧验收未激活；已核验原canary完整清理，淘汰旧许可后重新验收',evidence:{receipt:verified.receipt,signature:verified.signature}}});
   if(closed.rowCount)await afterTerminal(pool,row.evidence_task_id,'archived');
  }else await poolAuthorization.retire(machineId,{challenge_id:id,expected_version_id:state.expected_version_id});
  return committed||cleanupOnly?{phase:'renew_wait',expected_version_id:committed?row.execution_version_id:state.expected_version_id}:true;
 };
}
