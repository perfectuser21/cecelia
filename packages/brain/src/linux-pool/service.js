import { randomBytes,randomUUID } from 'node:crypto';
import { directory } from '../execution-directory/directory.js';
import { transaction } from '../execution-directory/store.js';
import { MACHINE_CAPACITY_LOCK_SQL } from '../orchestrator/attempt-machine-capacity.js';
import { createDeploymentReader,US_SCHEDULER_ID,UUID,error,exact } from './deployment.js';
import { verifyCanaryEnvelope } from './receipt.js';
import {lockOnboardingRevocation,stopAutomaticOnboarding,internallyRetiredPool} from './onboarding-revocation.js';
const request=(body,keys)=>{if(!exact(body,keys))throw error('linux_pool_request_invalid');};
const versionValid=v=>v===null||UUID.test(v??'');
/** 本片只准备授权记录。没有Linux脚本adapter验收，不生成active版本或grant。 */
export function createLinuxPoolAuthorization({pool,readDeployment=createDeploymentReader()}={}){
 async function locked(machineId,fn){
  if(!UUID.test(machineId??''))throw error('linux_pool_request_invalid');
  if(machineId===US_SCHEDULER_ID)throw error('linux_pool_machine_forbidden');
  const deployment=await readDeployment(machineId);
  if(deployment.expected.machine_registry_id!==machineId)throw error('linux_pool_deployment_invalid');
  return transaction(pool,async db=>{
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[deployment.expected.machine_id]);
   // 等锁期间部署可能换代；再次读取可信配置，永远不使用请求中的expected身份。
   const current=await readDeployment(machineId);if(current.policyDigest!==deployment.policyDigest)throw error('linux_pool_deployment_changed');
   const row=(await db.query("SELECT * FROM system_registry WHERE id=$1 AND type='machine' FOR SHARE",[machineId])).rows[0];
   if(!row||row.status!=='active'||['scheduler','scheduler_only'].includes(row.metadata?.role)||row.metadata?.scheduler_only===true)throw error('linux_pool_machine_forbidden');
   const node=(await db.query('SELECT * FROM execution_nodes WHERE machine_registry_id=$1',[machineId])).rows[0];
   if(node&&node.canonical_id!==deployment.expected.machine_id)throw error('linux_pool_identity_conflict');
   return fn(db,current,node);
  });
 }
 function cas(node,expected){if(!versionValid(expected)||(node?.current_version_id??null)!==expected)throw error('linux_pool_version_conflict');}
 async function challenge(machineId,body){
  request(body,['expected_version_id']);return locked(machineId,async(db,deployment,node)=>{
   cas(node,body.expected_version_id);
   const result=(await db.query(`INSERT INTO linux_pool_challenges(machine_registry_id,expected_version_id,expected,policy_digest,nonce,expires_at)
    VALUES($1,$2,$3,$4,$5,statement_timestamp()+interval '5 minutes') RETURNING id,nonce,created_at,expires_at`,[machineId,body.expected_version_id,deployment.expected,deployment.policyDigest,randomBytes(32).toString('hex')])).rows[0];
   return {...result,execution:false};
  });
 }
 async function attest(machineId,body){
  request(body,['challenge_id','envelope']);if(!UUID.test(body.challenge_id??''))throw error('linux_pool_request_invalid');
  return locked(machineId,async(db,deployment,node)=>{
   const c=(await db.query(`SELECT *,clock_timestamp() AS db_now FROM linux_pool_challenges WHERE id=$1 AND machine_registry_id=$2 AND state='issued' AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,[body.challenge_id,machineId])).rows[0];
   if(!c)throw error('linux_pool_challenge_unavailable');if(c.policy_digest!==deployment.policyDigest)throw error('linux_pool_deployment_changed');cas(node,c.expected_version_id);
   const verified=verifyCanaryEnvelope(body.envelope,c,deployment,new Date(c.db_now).getTime());
   const updated=await db.query("UPDATE linux_pool_challenges SET state='accepted',consumed_at=clock_timestamp() WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id",[c.id]);
   if(!updated.rowCount)throw error('linux_pool_challenge_unavailable');
   const a=(await db.query(`INSERT INTO linux_pool_attestations(challenge_id,machine_registry_id,receipt,signed_payload,signature,expires_at)
    VALUES($1,$2,$3,$4,$5,statement_timestamp()+interval '15 minutes') RETURNING id,state,expires_at`,[c.id,machineId,verified.receipt,verified.raw,verified.signature])).rows[0];
   return {...a,execution:false};
  });
 }
 async function activate(machineId,body){
  request(body,['attestation_id','expected_version_id']);if(!UUID.test(body.attestation_id??''))throw error('linux_pool_request_invalid');
  const result=await locked(machineId,async(db,deployment,node)=>{
   const a=(await db.query(`SELECT a.*,c.policy_digest,c.expected_version_id FROM linux_pool_attestations a JOIN linux_pool_challenges c ON c.id=a.challenge_id
    WHERE a.id=$1 AND a.machine_registry_id=$2 AND a.state='accepted' AND a.expires_at>clock_timestamp() AND c.state='accepted' FOR UPDATE OF a`,[body.attestation_id,machineId])).rows[0];
   if(!a)throw error('linux_pool_attestation_unavailable');cas(node,body.expected_version_id);
   if(a.expected_version_id!==body.expected_version_id)throw error('linux_pool_version_conflict');
   if(a.policy_digest!==deployment.policyDigest)throw error('linux_pool_deployment_changed');
   const e=deployment.expected,id=randomUUID();
   if(!node)await db.query('INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,$2)',[machineId,e.machine_id]);
   await db.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,worker_boot_id,platform,endpoints,profile,config_hash)
    SELECT $1,$2,COALESCE(MAX(revision),0)+1,'attested-v1',$3,$4,'linux',$5,$6,$7 FROM execution_node_versions WHERE machine_registry_id=$2`,
    [id,machineId,e.machine_id,e.worker_boot_id,{worker:e.endpoint},{machine_id:e.machine_id,capacity:0,execution:false,pool:e.pool,authorization_state:'ready'},e.config_digest]);
   for(const profile of e.script_profiles)await db.query(`INSERT INTO execution_grants(node_version_id,surface,provider,profile_id,provenance,expires_at)
    VALUES($1,'managed_script','script',$2,'linux_pool_attestation',$3)`,[id,profile,a.expires_at]);
   const changed=await db.query(`UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1 AND current_version_id IS NOT DISTINCT FROM $3::uuid RETURNING machine_registry_id`,[machineId,id,body.expected_version_id]);
   if(!changed.rowCount)throw error('linux_pool_version_conflict');
   const saved=await db.query("UPDATE linux_pool_attestations SET state='ready',execution_version_id=$2 WHERE id=$1 AND expires_at>clock_timestamp() RETURNING id",[a.id,id]);
   if(!saved.rowCount)throw error('linux_pool_attestation_unavailable');
   return {attestation_id:a.id,execution_version_id:id,authorization_state:'ready',execution:false,expires_at:a.expires_at};
  });await directory.refresh({pool});return result;
 }
 async function retireOrRevoke(machineId,body,internal){
  const selector=Object.hasOwn(body??{},'challenge_id')?'challenge_id':'attestation_id';
  request(body,[selector,'expected_version_id']);if(!UUID.test(machineId??'')||!UUID.test(body[selector]??''))throw error('linux_pool_request_invalid');
  // 撤销只需要持久身份；机器停用、部署文件或凭据丢失均不能阻止撤销。
  const found=(await pool.query(`SELECT c.* FROM linux_pool_challenges c ${selector==='attestation_id'?'JOIN linux_pool_attestations a ON a.challenge_id=c.id':''}
   WHERE ${selector==='attestation_id'?'a':'c'}.id=$1 AND c.machine_registry_id=$2`,[body[selector],machineId])).rows[0];
  if(!found)throw error('linux_pool_attestation_unavailable');
  const result=await transaction(pool,async db=>{
   if(!internal)await lockOnboardingRevocation(db,machineId);
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[found.expected.machine_id]);
   const node=(await db.query('SELECT * FROM execution_nodes WHERE machine_registry_id=$1',[machineId])).rows[0];cas(node,body.expected_version_id);
   if(node&&node.canonical_id!==found.expected.machine_id)throw error('linux_pool_identity_conflict');
   const current=(await db.query('SELECT state FROM linux_pool_challenges WHERE id=$1 FOR UPDATE',[found.id])).rows[0];
   if(internal){
    if(current.state==='revoked'&&!await internallyRetiredPool(db,found.id,machineId))throw error('linux_pool_explicitly_revoked');
    const marked=await db.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_pool_retired}',$2::jsonb),updated_at=now() WHERE claimed_by='linux-pool-onboarding' AND payload->'linux_onboarding'->'challenge'->>'id'=$1 AND payload->'linux_onboarding'->>'machine_registry_id'=$3 AND COALESCE(payload->'linux_onboarding'->>'revoked','false')<>'true'",[found.id,JSON.stringify(found.id),machineId]);
    if(!marked.rowCount)throw error('linux_pool_control_unavailable');
   }else await stopAutomaticOnboarding(db,machineId);
   await db.query("UPDATE linux_pool_challenges SET state='revoked' WHERE id=$1",[found.id]);
   const a=(await db.query("UPDATE linux_pool_attestations SET state='revoked' WHERE challenge_id=$1 RETURNING execution_version_id",[found.id])).rows[0];
   if(a?.execution_version_id){await db.query("UPDATE execution_grants SET state='revoked' WHERE node_version_id=$1",[a.execution_version_id]);await db.query("UPDATE execution_node_versions SET state='revoked' WHERE id=$1",[a.execution_version_id]);}
   return {authorization_state:'revoked',execution:false};
  });await directory.refresh({pool});return result;
 }
 async function get(machineId){
  if(!UUID.test(machineId??''))throw error('linux_pool_request_invalid');
  let deployment;try{deployment=await readDeployment(machineId);}catch{/* 读取失败仅呈现不可用，绝不延长旧验收。 */}
  const rows=(await pool.query(`SELECT a.id,a.state,a.expires_at,a.execution_version_id,a.expires_at<=clock_timestamp() AS expired,c.policy_digest,
   r.status AS machine_status,r.metadata FROM linux_pool_attestations a JOIN linux_pool_challenges c ON c.id=a.challenge_id
   JOIN system_registry r ON r.id=a.machine_registry_id WHERE a.machine_registry_id=$1 ORDER BY a.accepted_at DESC LIMIT 20`,[machineId])).rows;
  return {machine_registry_id:machineId,execution:false,attestations:rows.map(({policy_digest,machine_status,metadata,...r})=>({...r,
   state:r.state==='revoked'?'revoked':r.expired?'expired':!deployment?'unavailable':policy_digest!==deployment.policyDigest
    ||machine_status!=='active'||['scheduler','scheduler_only'].includes(metadata?.role)||metadata?.scheduler_only===true?'invalidated':r.state}))};
 }
 return {challenge,attest,activate,revoke:(machineId,body)=>retireOrRevoke(machineId,body,false),retire:(machineId,body)=>retireOrRevoke(machineId,body,true),get};
}
