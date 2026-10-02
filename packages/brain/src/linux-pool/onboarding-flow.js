import {MACHINE_CAPACITY_LOCK_SQL} from '../orchestrator/attempt-machine-capacity.js';
import {prepareFailedControllerRetry} from './onboarding-retry.js';
import {LINUX_POOL_AUTHORITY,LINUX_POOL_EXECUTOR_KIND} from './task-authority.js';
import {randomBytes,randomUUID} from 'node:crypto';
import {transaction} from '../execution-directory/store.js';
import {finalizeTask,afterTerminalTransition} from '../lib/task-terminal.js';
import {requestHash} from '../node-onboarding/spec.js';
import {createLinuxOnboardingStep} from './onboarding-step.js';
import {createRuntimeDeploymentReader} from './runtime-deployment.js';
import canaryModule from '../../scripts/fleet-worker/linux-pool-canary.cjs';
import poolModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
import {US_SCHEDULER_ID,error} from './deployment.js';
import {LIVE_RUNTIME_GRANTS_SQL,UNREVOKED_RUNTIME_GRANTS_SQL} from './active-grants.js';
const creator=async (args,internal)=>(await import('../actions.js')).createTask(args,internal);
const identityCheck=async state=>{const d=await createRuntimeDeploymentReader()(state.machine_registry_id);return canaryModule.readLinuxPoolIdentity({profile:poolModule.validateLinuxPoolProfile(d.pool),token:d.workerToken,revision:d.expected.revision,nonce:randomBytes(32).toString('hex')});};
const actor='linux-pool-onboarding',key=id=>'linux-onboarding:'+id;
const safeErrors=new Set(['linux_pool_control_unavailable','linux_pool_prerequisites_unavailable','linux_pool_onboarding_budget_unavailable','linux_pool_credentials_unconfirmed',
 'linux_pool_ssh_unavailable','linux_pool_installation_unconfirmed','linux_pool_runtime_unavailable','linux_pool_configuration_unconfirmed']);
export function createLinuxOnboardingFlow({pool,createTask=creator,revision=process.env.GIT_SHA,step=createLinuxOnboardingStep({pool}),afterTerminal=afterTerminalTransition,checkIdentity=identityCheck}={}){
 const eligible=m=>m.id!==US_SCHEDULER_ID&&m.metadata?.role==='worker'&&m.metadata?.node_health?.os==='linux'&&!m.metadata?.scheduler_only;
 const sourceTask=async(c,id)=>(await c.query('SELECT payload FROM tasks WHERE id=$1',[id])).rows[0]?.payload?.node_onboarding;
 const permitted=(source,machine)=>source?.id===machine.id&&source.request?.name===machine.name&&source.request.role==='worker'&&source.execution_revoked!==true;
 async function record(c,machine,state,parentId){
   const made=await createTask({db:c,title:'自动接入Linux执行池 '+machine.name,description:'可信SSH安装、池验收与受限脚本真实canary；只有同代授权激活才完成。',
    task_type:'audit',executor_kind:LINUX_POOL_EXECUTOR_KIND,status:'in_progress',source:'scheduler',source_id:'linux-pool-onboarding:'+state.nonce,trigger_source:'node_onboarding',allow_unscoped:true,
    parent_task_id:parentId,mutation_intent:'read_only',declared_domain:'operations',created_by:actor,payload:{linux_onboarding:state}},{linuxPoolAuthority:LINUX_POOL_AUTHORITY});
   if(!made?.success||!made.task?.id)throw error('linux_pool_control_unavailable');const id=made.task.id;
   await c.query("UPDATE tasks SET claimed_by=$2,claimed_at=now(),started_at=COALESCE(started_at,now()) WHERE id=$1",[id,actor]);
   await c.query("UPDATE tasks SET payload=jsonb_set(payload,'{node_onboarding,execution_task_id}',$2::jsonb),updated_at=now() WHERE id=$1",[state.parent_task_id,JSON.stringify(id)]);
   await c.query("UPDATE system_registry SET metadata=jsonb_set(metadata,'{onboarding,execution_task_id}',$2::jsonb),updated_at=now() WHERE id=$1",[machine.id,JSON.stringify(id)]);
   return id;
 }
 async function ensure(machine,parentId,db){
  if(!eligible(machine))return null;
  const work=async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key(machine.id)]);
   const source=await sourceTask(c,parentId);if(!permitted(source,machine))return null;
   const found=(await c.query("SELECT id FROM tasks WHERE payload->'linux_onboarding'->>'machine_registry_id'=$1 ORDER BY created_at DESC LIMIT 1",[machine.id])).rows[0];
   if(found)return found.id;
   const version=(await c.query('SELECT current_version_id FROM execution_nodes WHERE machine_registry_id=$1',[machine.id])).rows[0]?.current_version_id??null;
   const state={machine_registry_id:machine.id,onboarding_id:machine.metadata.onboarding.id,parent_task_id:parentId,
    phase:'probe',request_hash:requestHash(source.request),nonce:randomBytes(32).toString('hex'),intent_id:randomUUID(),revision,expected_version_id:version};
   return record(c,machine,state,parentId);
  };
  return db?work(db):transaction(pool,work);
 }
 async function live(c,machineId,runtimeId){
  if(!runtimeId)return null;
  return (await c.query(`SELECT a.id,a.execution_version_id,a.authorization_expires_at,r.metadata FROM linux_script_authorizations a
   JOIN execution_nodes n ON n.machine_registry_id=a.machine_registry_id AND n.current_version_id=a.execution_version_id
   JOIN system_registry r ON r.id=a.machine_registry_id WHERE a.id=$1 AND a.machine_registry_id=$2 AND a.state='active'
   AND ${LIVE_RUNTIME_GRANTS_SQL}
   AND a.authorization_expires_at>clock_timestamp() AND r.status='active' AND r.metadata->>'role'='worker'
   AND COALESCE(r.metadata->>'scheduler_only','false')<>'true' AND r.id<>$3`,[runtimeId,machineId,US_SCHEDULER_ID])).rows[0]??null;
 }
 async function view(id){
  if(!id)return {phase:'probe',execution:false};
  const row=(await pool.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0],s=row?.payload?.linux_onboarding;if(!s)return {phase:'probe',execution:false};
  if(s.revoked===true)return {task_id:id,phase:'revoked',execution:false};
  const source=await sourceTask(pool,s.parent_task_id);
  if(source?.request?.role!=='worker'||source.execution_revoked===true)return {task_id:id,phase:'revoked',execution:false};
  const runtime=s.runtime_json?JSON.parse(s.runtime_json).id:null;
  const active=s.phase==='active'?await live(pool,s.machine_registry_id,runtime):null;
  const authority=s.phase==='active'&&!active?(await pool.query(`SELECT a.state,(${UNREVOKED_RUNTIME_GRANTS_SQL}) AS intact FROM linux_script_authorizations a WHERE a.id=$1`,[runtime])).rows[0]:null;
  const revoked=authority&&(authority.state==='revoked'||authority.intact===false);
  const identityOk=s.identity_ok===true&&Date.now()-Date.parse(s.identity_checked_at)<180000;
  return {task_id:id,phase:s.phase==='active'?(revoked?'revoked':!active?'renewal':!identityOk?'identity':'active'):s.phase,execution:!!active&&identityOk,error:s.error??null,
   expires_at:active?.authorization_expires_at??null};
 }
 async function advance(id){
  const db=await pool.connect();let locked=false,machineId,completed=false;
  try{
   let task=(await db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];let state=task?.payload?.linux_onboarding;
   if(!state||task.status!=='in_progress')return {advanced:false};machineId=state.machine_registry_id;
   locked=(await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[key(machineId)])).rows[0].locked;if(!locked)return {busy:true};
   task=(await db.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0];state=task.payload.linux_onboarding;if(task.status!=='in_progress'||state.revoked===true)return {advanced:false};
   let machine=(await db.query("SELECT * FROM system_registry WHERE id=$1 AND type='machine' AND status='active'",[machineId])).rows[0];
   if(!machine||!eligible(machine))throw error('linux_pool_prerequisites_unavailable');
   const source=await sourceTask(db,state.parent_task_id);
   if(!permitted(source,machine)||requestHash(source.request)!==state.request_hash)throw error('linux_pool_control_unavailable');
   machine={...machine,metadata:{...machine.metadata,onboarding:{...machine.metadata.onboarding,request:source.request}}};
   const save=async value=>{
    const result=await db.query("UPDATE tasks SET payload=jsonb_set(payload,'{linux_onboarding}',$2::jsonb),updated_at=now() WHERE id=$1 AND status='in_progress' AND claimed_by=$3 RETURNING id",[id,JSON.stringify(value),actor]);
    if(result.rowCount!==1)throw error('linux_pool_control_unavailable');state=structuredClone(value);return true;
   };
   try{
    await step(task,machine,state,save);
    if(state.phase==='active'){
     const r=await live(db,machineId,JSON.parse(state.runtime_json).id);if(!r)throw error('linux_pool_runtime_unavailable');
     const result=await finalizeTask(db,id,'completed',{relay:false,onlyIfStatus:['in_progress'],where:{sql:'claimed_by=$1',params:[actor]},
      mergeResult:{actor,fact:'可信Linux安装、池证明及真实受管脚本canary已核验，同代执行授权已激活',evidence:{runtime_id:r.id,execution_version_id:r.execution_version_id,expires_at:r.authorization_expires_at},
       handoff:{schema_version:1,summary:'Linux执行池接入完成；授权到期前自动续验',next_steps:[]}}});
     if(result.rowCount!==1)throw error('linux_pool_control_unavailable');
     await checked(db,machineId,true,id);completed=true;
    }
    return {advanced:true,phase:state.phase};
   }catch(e){await save({...state,error:safeErrors.has(e.message)?e.message:'linux_pool_stage_unconfirmed',next_retry_at:new Date(Date.now()+30000).toISOString()});return {advanced:false,phase:state.phase};}
  }finally{
   try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtext($1))',[key(machineId)]);}finally{db.release();}
   if(completed)await afterTerminal(pool,id,'completed');
  }
 }
 async function retry(id,existingDb){
  const work=async c=>{
   let task=(await c.query('SELECT * FROM tasks WHERE id=$1',[id])).rows[0],s=task?.payload?.linux_onboarding;
   if(!s)throw error('linux_pool_retry_unconfirmed');
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key(s.machine_registry_id)]);
   task=(await c.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];s=task.payload.linux_onboarding;
   if(task.status==='in_progress'&&task.claimed_by===actor&&s.revoked!==true){
    await c.query("UPDATE tasks SET payload=jsonb_set(jsonb_set(payload,'{linux_onboarding,error}','null'::jsonb),'{linux_onboarding,next_retry_at}','null'::jsonb),updated_at=now() WHERE id=$1",[id]);return id;
   }
   const source=(await c.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE',[s.parent_task_id])).rows[0];
   const current=source?.payload?.node_onboarding?.execution_task_id;
   if(current&&current!==id){
    const next=(await c.query('SELECT * FROM tasks WHERE id=$1',[current])).rows[0];
    if(next?.parent_task_id===id&&next.executor_kind===LINUX_POOL_EXECUTOR_KIND&&next.claimed_by===actor
     &&next.status==='in_progress'&&next.payload?.linux_onboarding?.resume_of_task_id===id)return current;
    throw error('linux_pool_retry_unconfirmed');
   }
   const candidate=(await c.query("SELECT name FROM system_registry WHERE id=$1 AND type='machine' AND status='active'",[s.machine_registry_id])).rows[0];
   if(!candidate)throw error('linux_pool_retry_unconfirmed');
   // 与runtime保持capacity→registry同序；取得行锁后复核机器名，防读取期间换代。
   await c.query(MACHINE_CAPACITY_LOCK_SQL,[candidate.name]);
   const machine=(await c.query("SELECT * FROM system_registry WHERE id=$1 AND type='machine' AND status='active' FOR UPDATE",[s.machine_registry_id])).rows[0];
   if(!machine||machine.name!==candidate.name||!eligible(machine))throw error('linux_pool_retry_unconfirmed');
   const state=await prepareFailedControllerRetry(c,task,source,machine,revision);
   const next=await record(c,machine,state,id);
   await c.query("INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES($1,'linux_controller_retry',$2,now())",
    [id,{actor,fact:'已验明旧专管任务被本机孤儿探针误收；保留failed历史并登记新控制棒',evidence:{continuation_task_id:next,source_task_id:source.id,revision}}]);
   return next;
  };
  const taskId=existingDb?await work(existingDb):await transaction(pool,work);
  // 外层enrollment事务尚未提交；只返回此处已核身份，不用另一连接读旧投影。
  return existingDb?{task_id:taskId}:view(taskId);
 }

 async function checked(c,machineId,ok,taskId){
  await c.query("UPDATE tasks SET payload=jsonb_set(jsonb_set(payload,'{linux_onboarding,identity_checked_at}',$2::jsonb),'{linux_onboarding,identity_ok}',$3::jsonb),updated_at=now() WHERE id=$1 AND (claimed_by=$4 OR status='completed' AND result->>'actor'=$4) AND payload->'linux_onboarding'->>'machine_registry_id'=$5",[taskId,JSON.stringify(new Date().toISOString()),JSON.stringify(ok),actor,machineId]);
 }
 async function renew(){
  const candidates=(await pool.query(`SELECT t.* FROM tasks t JOIN system_registry r ON t.payload->'linux_onboarding'->>'machine_registry_id'=r.id::text
   WHERE t.status='completed' AND t.payload->'linux_onboarding'->>'phase'='active' AND r.status='active'
   AND t.result->>'actor'='linux-pool-onboarding' AND NOT EXISTS(SELECT 1 FROM tasks newer
    WHERE newer.payload->'linux_onboarding'->>'machine_registry_id'=r.id::text AND (newer.created_at,newer.id)>(t.created_at,t.id))
   AND COALESCE(t.payload->'linux_onboarding'->>'identity_checked_at','')<$1 ORDER BY r.updated_at LIMIT 1`,[new Date(Date.now()-60000).toISOString()])).rows;
  if(!candidates[0])return null;const previous=candidates[0],s=previous.payload.linux_onboarding;
  let changed=false;try{changed=(await checkIdentity(s)).worker_boot_id!==JSON.parse(s.installation_json).receipt.worker_boot_id;await checked(pool,s.machine_registry_id,!changed,previous.id);}
  catch{await checked(pool,s.machine_registry_id,false,previous.id);}
  return transaction(pool,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key(s.machine_registry_id)]);
   const machine=(await c.query('SELECT * FROM system_registry WHERE id=$1 FOR UPDATE',[s.machine_registry_id])).rows[0];
   if(!machine||!eligible(machine)||!permitted(await sourceTask(c,s.parent_task_id),machine))return null;
   const latest=(await c.query("SELECT id FROM tasks WHERE payload->'linux_onboarding'->>'machine_registry_id'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",[machine.id])).rows[0];
   if(latest?.id!==previous.id)return null;
   const authority=(await c.query(`SELECT a.state FROM linux_script_authorizations a JOIN execution_nodes n ON n.machine_registry_id=a.machine_registry_id
    WHERE a.id=$1 AND n.current_version_id=a.execution_version_id AND ${UNREVOKED_RUNTIME_GRANTS_SQL}`,[JSON.parse(s.runtime_json).id])).rows[0];
   if(authority?.state!=='active')return null; // 显式撤销/外部换代不得被自动续验覆盖。
   const current=await live(c,machine.id,JSON.parse(s.runtime_json).id);
   if(!changed&&current&&new Date(current.authorization_expires_at).getTime()-Date.now()>3600000)return null;
   const state={...s,phase:'renew_revoke',nonce:randomBytes(32).toString('hex'),previous_runtime_id:JSON.parse(s.runtime_json).id,
    expected_version_id:s.active.execution_version_id,error:null,next_retry_at:null};
   delete state.active;delete state.runtime_json;delete state.script_envelope_json;delete state.pool_envelope_json;delete state.challenge;delete state.attestation_id;
   return record(c,machine,state,previous.id);
  });
 }
 async function run(){
  const waiting=(await pool.query("SELECT * FROM system_registry WHERE type='machine' AND status='active' AND metadata->>'role'='worker' AND metadata->'node_health'->>'os'='linux' AND metadata->'onboarding'->>'state'='managed' AND metadata->'onboarding'->>'execution_task_id' IS NULL LIMIT 1")).rows[0];
  if(waiting)await ensure(waiting,waiting.metadata.onboarding.task_id);
  await renew();
  const rows=(await pool.query("SELECT id FROM tasks WHERE status='in_progress' AND claimed_by=$1 AND payload ? 'linux_onboarding' AND COALESCE(payload->'linux_onboarding'->>'revoked','false')<>'true' AND COALESCE(payload->'linux_onboarding'->>'next_retry_at','')<$2 ORDER BY updated_at LIMIT 1",[actor,new Date().toISOString()])).rows;
  return rows[0]?advance(rows[0].id):{advanced:false};
 }
 return {ensure,advance,view,retry,run,renew};
}
