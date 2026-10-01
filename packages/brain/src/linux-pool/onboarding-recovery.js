import {createDeploymentReader,error} from './deployment.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
import {verifyCanaryEnvelope} from './receipt.js';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
/** 过期证明只能证明旧canary已清理，绝不能激活或延长许可。未知回执继续原nonce。 */
export function createOnboardingRecovery({pool,poolAuthorization,runtimeAuthorization,readPool=createDeploymentReader(),readRuntime=createRuntimeDeploymentReader(),afterTerminal=afterTerminalTransition}={}){
 return async(kind,machineId,state,envelope)=>{
  const script=kind==='script',id=script?JSON.parse(state.runtime_json).id:state.challenge.id;
  const row=(await pool.query(script?'SELECT *,clock_timestamp() AS db_now FROM linux_script_authorizations WHERE id=$1 AND machine_registry_id=$2':
   `SELECT c.*,clock_timestamp() AS db_now,a.state AS attestation_state,a.expires_at AS attestation_expires_at FROM linux_pool_challenges c
    LEFT JOIN linux_pool_attestations a ON a.challenge_id=c.id WHERE c.id=$1 AND c.machine_registry_id=$2`,[id,machineId])).rows[0];
  if(!row)throw error('linux_pool_stage_unconfirmed');
  if(script?row.state==='active':row.attestation_state==='ready')return false;
  const deadline=script?row.challenge_expires_at:row.attestation_expires_at??row.expires_at;
  // 证明本身5分钟freshness也可能先过期。安全恢复依然必须完整验签输出和精确墓碑。
  const completed=Date.parse(envelope?.receipt?.completed_at),now=new Date(row.db_now).getTime();
  if(new Date(deadline).getTime()>now&&Number.isFinite(completed)&&now-completed<=300000)return false;
  const deployment=await (script?readRuntime:readPool)(machineId);
  if(row.policy_digest!==deployment.policyDigest||!Number.isFinite(completed)||completed>now+1000)throw error('linux_pool_stage_unconfirmed');
  const verified=(script?verifyRuntimeEnvelope:verifyCanaryEnvelope)(envelope,row,deployment,completed);
  if(script){
   await runtimeAuthorization.revoke(machineId,{runtime_id:id,expected_version_id:state.expected_version_id});
   const closed=await finalizeTask(pool,row.evidence_task_id,'archived',{relay:false,onlyIfStatus:['in_progress'],where:{sql:'claimed_by=$1',params:['linux-script-canary:'+id]},
    mergeResult:{actor:'linux-pool-onboarding',fact:'旧验收挑战过期；已核验原canary完整清理，撤销旧许可后重新验收',evidence:{receipt:verified.receipt,signature:verified.signature}}});
   if(closed.rowCount)await afterTerminal(pool,row.evidence_task_id,'archived');
  }else await poolAuthorization.revoke(machineId,{challenge_id:id,expected_version_id:state.expected_version_id});
  return true;
 };
}
