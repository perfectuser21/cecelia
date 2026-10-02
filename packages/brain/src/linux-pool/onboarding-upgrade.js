import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createDeploymentReader,error,UUID,HEX,exact} from './deployment.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
import {createOnboardingArtifacts} from './onboarding-artifact.js';
import {verifyLinuxInstallation} from './onboarding-installation.js';
import {verifyCleanupEnvelope} from './cleanup-receipt.js';
import {LINUX_POOL_EXECUTOR_KIND} from './task-authority.js';
const deny=()=>{throw error('linux_pool_bootstrap_recovery_unconfirmed');};
const hash=v=>createHash('sha256').update(v).digest('hex');
function attemptBinding(machineId,s,files){
 const bound={machine_registry_id:machineId,pool:JSON.parse(s.policy_json).pool,revision:s.revision,sources:files};
 if(s.upgrade_json)Object.assign(bound,{upgrade:JSON.parse(s.upgrade_json),previous_attempt:s.previous_attempt});
 return hash(JSON.stringify(bound));
}
async function retiredCleanup(db,task,d,marker){
 const s=task.payload?.linux_onboarding;
 if(!UUID.test(marker??'')||s?.last_cleanup_runtime_id!==marker||d.parent_task_id!==task.id||d.expected.revision!==s.revision)deny();
 const r=(await db.query(`SELECT a.*,t.status AS evidence_status,t.parent_task_id AS evidence_parent_task_id,
  t.executor_kind AS evidence_kind,t.created_by AS evidence_created_by,t.payload AS evidence_payload,t.result AS evidence_result
  FROM linux_script_authorizations a JOIN tasks t ON t.id=a.evidence_task_id WHERE a.id=$1 AND a.machine_registry_id=$2 FOR SHARE OF a,t`,[marker,s.machine_registry_id])).rows[0];
 if(!r||r.id!==marker||r.machine_registry_id!==s.machine_registry_id||r.state!=='revoked'||r.signed_payload!=null
  ||r.expected_version_id!==s.expected_version_id||r.policy_digest!==d.policyDigest||r.evidence_parent_task_id!==task.id
  ||r.evidence_status!=='archived'||r.evidence_kind!==LINUX_POOL_EXECUTOR_KIND||r.evidence_created_by!=='linux-pool-onboarding'
  ||r.evidence_payload?.machine_registry_id!==s.machine_registry_id||r.evidence_payload?.linux_script_runtime_id!==r.id
  ||r.evidence_payload?.linux_runtime_retired!==r.id||r.evidence_payload?.linux_runtime_revoked===true
  ||r.evidence_result?.actor!=='linux-pool-onboarding')deny();
 const e=r.evidence_result.evidence;if(typeof e?.envelope_json!=='string'||Buffer.byteLength(e.envelope_json)>262144)deny();
 const envelope=JSON.parse(e.envelope_json);
 if(!isDeepStrictEqual(envelope.receipt,e.receipt)||envelope.signature!==e.signature)deny();
 verifyCleanupEnvelope('script',envelope,r,d,Date.now());
}

/** 调用方先持同机onboarding会话锁，再持capacity事务锁；网络副作用期间不可释放。 */
export async function requireBootstrapIdle(db,machine,state){
 if((await db.query("SELECT id FROM capacity_reservations WHERE machine_id=$1 AND status<>'released' LIMIT 1",[machine.name])).rowCount)deny();
 const node=(await db.query('SELECT current_version_id FROM execution_nodes WHERE machine_registry_id=$1',[machine.id])).rows[0];
 if((node?.current_version_id??null)!==state.expected_version_id)deny();
 if((await db.query(`SELECT g.id FROM execution_grants g JOIN execution_node_versions v ON v.id=g.node_version_id
  WHERE v.machine_registry_id=$1 AND g.surface='managed_script' AND g.state='active' LIMIT 1`,[machine.id])).rowCount)deny();
 const runtimes=(await db.query(`SELECT a.id,a.state,t.status,t.payload,t.result FROM linux_script_authorizations a
  LEFT JOIN tasks t ON t.id=a.evidence_task_id WHERE a.machine_registry_id=$1`,[machine.id])).rows;
 if(runtimes.some(r=>r.state!=='revoked'||r.status!=='archived'||r.payload?.linux_runtime_revoked===true
  ||r.payload?.linux_runtime_retired!==r.id||r.result?.actor!=='linux-pool-onboarding'
  ||r.result?.evidence?.receipt?.cleanup_confirmed!==true))deny();
}
export function createBootstrapRecovery({artifacts=createOnboardingArtifacts(),readRuntime=createRuntimeDeploymentReader(),readPool=createDeploymentReader()}={}){
 async function contract(db,task,source,machine,intent,phase='bootstrap'){
  const s=task.payload?.linux_onboarding,meta=source?.payload?.node_onboarding;
  if(task.status!=='in_progress'||task.executor_kind!==LINUX_POOL_EXECUTOR_KIND||task.claimed_by!=='linux-pool-onboarding'
   ||task.created_by!=='linux-pool-onboarding'||s?.phase!==phase||s.revoked===true
   ||s.machine_registry_id!==machine.id||s.parent_task_id!==source?.id||source.status!=='completed'
   ||meta?.id!==machine.id||meta.execution_task_id!==task.id||meta.execution_revoked===true
   ||meta.request?.role!=='worker'||meta.request.name!==machine.name||!UUID.test(intent??''))deny();
  await requireBootstrapIdle(db,machine,s);
  const d=await readRuntime(machine.id),pd=await readPool(machine.id),p=JSON.parse(s.policy_json);
  if(d.policyDigest!==s.runtime_policy_digest||pd.policyDigest!==s.pool_policy_digest
   ||!isDeepStrictEqual(d.pool,p.pool)||!isDeepStrictEqual(d.profiles,p.profiles)||p.capacity!==1
   ||d.authority.worker_credential.file!==s.credential_files?.worker_credential_file
   ||d.authority.execution_credential.file!==s.credential_files?.execution_credential_file
   ||d.workerToken!==pd.token||d.expected.pool_config_digest!==pd.expected.config_digest
   ||['machine_registry_id','revision','host_boot_id','worker_boot_id','daemon_id'].some(k=>d.expected[k]!==pd.expected[k]))deny();
  const previous=(await db.query('SELECT * FROM tasks WHERE id=$1',[d.parent_task_id])).rows[0],old=previous?.payload?.linux_onboarding;
  if(previous?.created_by!=='linux-pool-onboarding'||old?.machine_registry_id!==machine.id||old.parent_task_id!==source.id
   ||old.revision!==d.expected.revision||old.policy_json!==s.policy_json)deny();
  const envelope=JSON.parse(old.installation_json);
  // 这是私有部署已消费的历史安装凭证；历史验签不代替远端fresh空闲/boot/文件验证。
  const receipt=verifyLinuxInstallation(envelope,{machine_registry_id:machine.id,nonce:old.nonce,intent_id:old.intent_id,pool:p.pool,revision:old.revision,key:d.key},Date.parse(envelope.receipt?.observed_at));
  if(['host_boot_id','worker_boot_id','daemon_id','revision'].some(k=>receipt[k]!==d.expected[k]))deny();
  const installed=artifacts.read(old.revision,old.artifact_digest);
  return {schema_version:1,machine_registry_id:machine.id,config_digest:d.expected.pool_config_digest,revision:old.revision,
   host_boot_id:d.expected.host_boot_id,daemon_id:d.expected.daemon_id,worker_boot_id:d.expected.worker_boot_id,
   source_sha256:Object.fromEntries(Object.entries(installed.files).filter(([name])=>name!=='linux-pool-installer.cjs').map(([name,value])=>[name,hash(value)])),intent_id:intent};
 }
 async function prepare(db,task,source,machine){
  try{
   const s=task.payload?.linux_onboarding;
   if(s?.error!=='linux_pool_ssh_unavailable'||s.upgrade_json||s.previous_attempt)deny();
   const intent=randomUUID(),upgrade=await contract(db,task,source,machine,intent),old=artifacts.read(s.revision,s.artifact_digest);
   const binding=hash(JSON.stringify({machine_registry_id:machine.id,pool:JSON.parse(s.policy_json).pool,revision:s.revision,sources:old.files}));
   const current=artifacts.capture();if(current.revision===s.revision)deny();
   return {...s,revision:current.revision,artifact_digest:current.digest,intent_id:intent,nonce:randomBytes(32).toString('hex'),
    upgrade_json:JSON.stringify(upgrade),previous_attempt:{intent_id:s.intent_id,binding},error:null,next_retry_at:null};
  }catch{deny();}
 }
 async function prepareInstalled(db,task,source,machine){
  try{
   const s=task.payload?.linux_onboarding;
   if(s?.phase!=='renew_wait'||s.runtime_json!=null||s.active||machine.metadata?.onboarding?.execution_task_id!==task.id)deny();
   const intent=randomUUID(),upgrade=await contract(db,task,source,machine,intent,'renew_wait'),d=await readRuntime(machine.id);
   if(d.policyDigest!==s.runtime_policy_digest)deny();
   await retiredCleanup(db,task,d,s.last_cleanup_runtime_id);
   const old=artifacts.read(s.revision,s.artifact_digest),current=artifacts.capture();if(current.revision===s.revision)deny();
   const keep=['machine_registry_id','onboarding_id','parent_task_id','request_hash','expected_version_id','policy_json','credential_files','credentials','runtime_policy_digest','pool_policy_digest'];
   return {...Object.fromEntries(keep.filter(k=>s[k]!==undefined).map(k=>[k,s[k]])),phase:'bootstrap',revision:current.revision,artifact_digest:current.digest,
    intent_id:intent,nonce:randomBytes(32).toString('hex'),upgrade_json:JSON.stringify(upgrade),
    previous_attempt:{intent_id:s.intent_id,binding:attemptBinding(machine.id,s,old.files)},resume_of_task_id:task.id,upgrade_cleanup_runtime_id:s.last_cleanup_runtime_id,error:null,next_retry_at:null};
  }catch{deny();}
 }
 async function authorize(db,task,source,machine){
  try{
   const s=task.payload.linux_onboarding;
   if(!exact(s.previous_attempt,['intent_id','binding'])||!UUID.test(s.previous_attempt.intent_id)||!HEX.test(s.previous_attempt.binding)
    ||s.previous_attempt.intent_id===s.intent_id)deny();
   const d=await readRuntime(machine.id),old=(await db.query('SELECT * FROM tasks WHERE id=$1',[d.parent_task_id])).rows[0],os=old?.payload?.linux_onboarding;
   if(s.upgrade_cleanup_runtime_id||old?.status==='archived'){
    if(old?.id!==s.resume_of_task_id||old.status!=='archived'||old.executor_kind!==LINUX_POOL_EXECUTOR_KIND||old.created_by!=='linux-pool-onboarding'
     ||old.result?.actor!=='linux-pool-onboarding'||old.result?.evidence?.continuation_task_id!==task.id||d.policyDigest!==s.runtime_policy_digest
     ||os?.phase!=='renew_wait'||os.parent_task_id!==s.parent_task_id||os.policy_json!==s.policy_json||os.intent_id!==s.previous_attempt.intent_id)deny();
    await retiredCleanup(db,old,d,s.upgrade_cleanup_runtime_id);
    if(s.previous_attempt.binding!==attemptBinding(machine.id,os,artifacts.read(os.revision,os.artifact_digest).files))deny();
   }
   const expected=await contract(db,task,source,machine,s.intent_id);
   if(JSON.stringify(expected)!==s.upgrade_json)deny();
   artifacts.read(s.revision,s.artifact_digest);
  }catch{deny();}
 }
 return {prepare,prepareInstalled,authorize};
}
