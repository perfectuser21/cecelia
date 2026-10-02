import {randomBytes,randomUUID} from 'node:crypto';
import {directory} from '../execution-directory/directory.js';
import {transaction} from '../execution-directory/store.js';
import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {US_SCHEDULER_ID,UUID,exact,error} from './deployment.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
import {UNREVOKED_RUNTIME_GRANTS_SQL} from './active-grants.js';
import {lockOnboardingRevocation,stopAutomaticOnboarding} from './onboarding-revocation.js';
const taskCreator=async args=>(await import('../actions.js')).createTask(args);
const request=(body,keys)=>{if(!exact(body,keys))throw error('linux_pool_request_invalid');};
const cas=(node,id)=>{if(id!==null&&!UUID.test(id??'')||(node?.current_version_id??null)!==id)throw error('linux_pool_version_conflict');};
export function createLinuxRuntimeAuthorization({pool,readDeployment=createRuntimeDeploymentReader(),createTask=taskCreator,afterTerminal=afterTerminalTransition}={}){
 async function locked(machineId,fn){
  if(!UUID.test(machineId??''))throw error('linux_pool_request_invalid');if(machineId===US_SCHEDULER_ID)throw error('linux_pool_machine_forbidden');
  const d=await readDeployment(machineId);if(d.expected.machine_registry_id!==machineId)throw error('linux_pool_runtime_deployment_invalid');
  return transaction(pool,async db=>{
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[d.machine_id]);const current=await readDeployment(machineId);
   if(current.policyDigest!==d.policyDigest)throw error('linux_pool_deployment_changed');
   const machine=(await db.query("SELECT * FROM system_registry WHERE id=$1 AND type='machine' FOR SHARE",[machineId])).rows[0];
   if(!machine||machine.status!=='active'||['scheduler','scheduler_only'].includes(machine.metadata?.role)||machine.metadata?.scheduler_only===true)throw error('linux_pool_machine_forbidden');
   const node=(await db.query('SELECT * FROM execution_nodes WHERE machine_registry_id=$1',[machineId])).rows[0];
   if(node&&node.canonical_id!==d.machine_id)throw error('linux_pool_identity_conflict');return fn(db,current,node);
  });
 }
 function prepared(r,p){
  // profile摘要包含序列化顺序；只从已核policyDigest的受信源回送原profile，不能用JSONB重排投影。
  return {id:r.id,nonce:r.nonce,execution_version_id:r.execution_version_id,evidence_task_id:r.evidence_task_id,grant_ids:r.grant_ids,
   expires_at:r.challenge_expires_at,execution:false,runtime_configuration:{pool:p.pool,...p.expected,execution_enabled:true,
    profiles:Object.fromEntries(Object.entries(p.profiles).map(([id,e])=>[id,{...e,execution_version_id:r.execution_version_id,execution_grant_id:r.grant_ids[id]}]))}};
 }
 async function prepare(machineId,body){
  request(body,['expected_version_id']);return locked(machineId,async(db,d,node)=>{
   cas(node,body.expected_version_id);
   const existing=(await db.query(`SELECT * FROM linux_script_authorizations WHERE machine_registry_id=$1 AND expected_version_id IS NOT DISTINCT FROM $2::uuid
    AND policy_digest=$3 AND state='prepared' AND challenge_expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1`,[machineId,body.expected_version_id,d.policyDigest])).rows[0];
   if(existing)return prepared(existing,d);
   if(!(await db.query('SELECT id FROM tasks WHERE id=$1 FOR SHARE',[d.parent_task_id])).rowCount)throw error('linux_pool_parent_task_unavailable');
   const id=randomUUID(),version=randomUUID(),claimant='linux-script-canary:'+id;
   const made=await createTask({db,title:`验收Linux受管脚本池 ${d.machine_id} ${id}`,description:'核验root受限adapter的真实输出、宿主slice与精确清理，完成后方可激活同代授权。',
    task_type:'audit',status:'in_progress',source:'scheduler',source_id:'linux-script-canary:'+id,trigger_source:'linux_pool_onboarding',allow_unscoped:true,
    parent_task_id:d.parent_task_id,mutation_intent:'read_only',declared_domain:'operations',created_by:'linux-pool-onboarding',payload:{linux_script_runtime_id:id,machine_registry_id:machineId}});
   if(!made?.success||!UUID.test(made.task?.id??''))throw error('linux_pool_evidence_task_unavailable');
   const evidence=made.task.id;await db.query("UPDATE tasks SET claimed_by=$2,claimed_at=now(),started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status='in_progress'",[evidence,claimant]);
   if(!node)await db.query('INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,$2)',[machineId,d.machine_id]);
   await db.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,worker_boot_id,platform,endpoints,profile,config_hash)
    SELECT $1,$2,COALESCE(MAX(revision),0)+1,'attested-v1',$3,$4,'linux',$5,$6,$7 FROM execution_node_versions WHERE machine_registry_id=$2`,
    [version,machineId,d.machine_id,d.expected.worker_boot_id,{worker:d.endpoint},{machine_id:d.machine_id,execution:true,capacity:1,pool:d.pool.pool,linux_script:d.authority},d.policyDigest]);
   const grantIds={};for(const profileId of Object.keys(d.profiles)){const grant=randomUUID();grantIds[profileId]=grant;
    await db.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,profile_id,provenance,evidence_task_id,expires_at)
     VALUES($1,$2,'managed_script','script',$3,'linux_script_canary',$4,statement_timestamp()+interval '24 hours')`,[grant,version,profileId,evidence]);}
   const {key:_key,workerToken:_workerToken,policyDigest,...policy}=d;
   const r=(await db.query(`INSERT INTO linux_script_authorizations(id,machine_registry_id,expected_version_id,execution_version_id,evidence_task_id,policy,policy_digest,grant_ids,nonce,challenge_expires_at,authorization_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,statement_timestamp()+interval '10 minutes',statement_timestamp()+interval '24 hours') RETURNING *`,
    [id,machineId,body.expected_version_id,version,evidence,policy,policyDigest,grantIds,randomBytes(32).toString('hex')])).rows[0];return prepared(r,d);
  });
 }
 const activeResult=r=>({id:r.id,execution_version_id:r.execution_version_id,evidence_task_id:r.evidence_task_id,authorization_state:'active',execution:true,expires_at:r.authorization_expires_at});
 async function activate(machineId,body){
  request(body,['runtime_id','expected_version_id','envelope']);if(!UUID.test(body.runtime_id??''))throw error('linux_pool_request_invalid');let completed=null;
  const result=await locked(machineId,async(db,d,node)=>{
   const r=(await db.query(`SELECT *,clock_timestamp() AS db_now FROM linux_script_authorizations WHERE id=$1 AND machine_registry_id=$2
    AND state IN ('prepared','active') AND authorization_expires_at>clock_timestamp() FOR UPDATE`,[body.runtime_id,machineId])).rows[0];
   if(!r||r.expected_version_id!==body.expected_version_id)throw error('linux_pool_runtime_unavailable');
   if(r.policy_digest!==d.policyDigest)throw error('linux_pool_deployment_changed');
   if(r.state==='active'){
    cas(node,r.execution_version_id);if(JSON.stringify(body.envelope?.receipt)!==r.signed_payload||body.envelope?.signature!==r.signature)throw error('linux_pool_runtime_receipt_invalid');return activeResult(r);
   }
   cas(node,body.expected_version_id);if(new Date(r.challenge_expires_at)<=new Date(r.db_now))throw error('linux_pool_runtime_unavailable');
   const verified=verifyRuntimeEnvelope(body.envelope,r,d,new Date(r.db_now).getTime());
   const evidence={fact:'受限脚本adapter各profile的随机标记输出、宿主slice与完整身份清理全部验真',actor:'linux-script-canary:'+machineId,evidence:{receipt:verified.receipt,signature:verified.signature},
    handoff:{schema_version:1,summary:'Linux受管脚本真实canary验收完成；同事务激活对应版本许可',next_steps:[]}};
   const task=await finalizeTask(db,r.evidence_task_id,'completed',{relay:false,onlyIfStatus:['in_progress'],where:{sql:'claimed_by=$1',params:['linux-script-canary:'+r.id]},mergeResult:evidence});
   if(task.rowCount!==1)throw error('linux_pool_evidence_task_unavailable');
   const accepted=await db.query(`UPDATE linux_script_authorizations SET state='accepted',receipt=$2,signed_payload=$3,signature=$4,accepted_at=clock_timestamp()
    WHERE id=$1 AND challenge_expires_at>clock_timestamp() RETURNING id`,[r.id,verified.receipt,verified.raw,verified.signature]);
   if(!accepted.rowCount)throw error('linux_pool_runtime_unavailable');
   const version=await db.query("UPDATE execution_node_versions SET state='active' WHERE id=$1 AND state='pending' RETURNING id",[r.execution_version_id]);
   if(!version.rowCount)throw error('linux_pool_version_conflict');
   const grants=await db.query("UPDATE execution_grants SET state='active' WHERE node_version_id=$1 AND state='pending' RETURNING id",[r.execution_version_id]);
   if(grants.rowCount!==Object.keys(r.grant_ids).length)throw error('linux_pool_version_conflict');
   const changed=await db.query('UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1 AND current_version_id IS NOT DISTINCT FROM $3::uuid RETURNING machine_registry_id',[machineId,r.execution_version_id,body.expected_version_id]);
   if(!changed.rowCount)throw error('linux_pool_version_conflict');
   await db.query("UPDATE linux_script_authorizations SET state='active',activated_at=clock_timestamp() WHERE id=$1",[r.id]);completed=r.evidence_task_id;return activeResult(r);
  });await directory.refresh({pool});if(completed)await afterTerminal(pool,completed,'completed');return result;
 }
 async function retireOrRevoke(machineId,body,internal){
  request(body,['runtime_id','expected_version_id']);if(!UUID.test(machineId??'')||!UUID.test(body.runtime_id??''))throw error('linux_pool_request_invalid');
  const found=(await pool.query('SELECT * FROM linux_script_authorizations WHERE id=$1 AND machine_registry_id=$2',[body.runtime_id,machineId])).rows[0];if(!found)throw error('linux_pool_runtime_unavailable');
  await transaction(pool,async db=>{
   // 外部撤销先等正在执行的接入阶段提交，再持久阻止下一阶段；内部调用已持同一会话锁。
   if(!internal)await lockOnboardingRevocation(db,machineId);
   await db.query(MACHINE_CAPACITY_LOCK_SQL,[found.policy.machine_id]);const node=(await db.query('SELECT * FROM execution_nodes WHERE machine_registry_id=$1',[machineId])).rows[0];cas(node,body.expected_version_id);
   const authority=(await db.query(`SELECT a.state,(${UNREVOKED_RUNTIME_GRANTS_SQL}) AS intact,t.payload FROM linux_script_authorizations a
    JOIN tasks t ON t.id=a.evidence_task_id WHERE a.id=$1 FOR UPDATE OF a,t`,[found.id])).rows[0];
   if(internal){
    if(authority.payload?.linux_runtime_revoked===true||authority.state==='revoked'&&authority.payload?.linux_runtime_retired!==found.id
     ||authority.state==='active'&&!authority.intact)throw error('linux_pool_explicitly_revoked');
    await db.query("UPDATE tasks SET payload=jsonb_set(COALESCE(payload,'{}'),'{linux_runtime_retired}',$2::jsonb),updated_at=now() WHERE id=$1",[found.evidence_task_id,JSON.stringify(found.id)]);
   }else{
    await db.query("UPDATE tasks SET payload=jsonb_set(COALESCE(payload,'{}'),'{linux_runtime_revoked}','true'),updated_at=now() WHERE id=$1",[found.evidence_task_id]);
    await stopAutomaticOnboarding(db,machineId);
   }
   await db.query("UPDATE linux_script_authorizations SET state='revoked' WHERE id=$1",[found.id]);
   await db.query("UPDATE execution_grants SET state='revoked' WHERE node_version_id=$1",[found.execution_version_id]);await db.query("UPDATE execution_node_versions SET state='revoked' WHERE id=$1",[found.execution_version_id]);
  });await directory.refresh({pool});return {id:found.id,authorization_state:'revoked',execution:false};
 }
 return {prepare,activate,revoke:(machineId,body)=>retireOrRevoke(machineId,body,false),retire:(machineId,body)=>retireOrRevoke(machineId,body,true)};
}
