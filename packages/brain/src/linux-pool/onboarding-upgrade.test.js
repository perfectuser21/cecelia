import {it,expect} from 'vitest';
import {createHash,randomUUID,createHmac} from 'node:crypto';
import {buildLinuxOnboardingPolicy} from './onboarding-policy.js';
import {normalizeDeployment} from './deployment.js';
import {normalizeRuntimeDeployment} from './runtime-deployment.js';
import {createBootstrapRecovery} from './onboarding-upgrade.js';
import {ONBOARDING_IMAGE} from './onboarding-step.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
function setup(){
 const machine={id:randomUUID(),name:'new-linux',metadata:{role:'worker'}},parent=randomUUID(),oldId=randomUUID(),id=randomUUID(),boot=randomUUID(),worker=randomUUID();
 const request={name:machine.name,address:'100.64.0.2',role:'worker'},p=buildLinuxOnboardingPolicy({machine_registry_id:machine.id,machine_id:machine.name,role:'worker',endpoint_host:request.address,image:ONBOARDING_IMAGE,image_id:'sha256:'+'c'.repeat(64),observation:{os:'linux',observed_at:new Date().toISOString(),resources:{cpu_cores:4,memory_total_bytes:8*2**30}}});
 const files={worker_credential_file:'/etc/worker',execution_credential_file:'/etc/key'},common={revision:'a'.repeat(40),host_boot_id:boot,worker_boot_id:worker,daemon_id:'daemon'};
 const d=normalizeRuntimeDeployment({...common,pool:p.pool,profiles:p.profiles,...files,parent_task_id:oldId},'e'.repeat(64),'f'.repeat(64));
 const pd=normalizeDeployment({...common,profile:p.pool,image_id:'sha256:'+'c'.repeat(64),script_profiles:['shell'],credential_file:files.worker_credential_file},'e'.repeat(64));
 const receipt={schema_version:'linux-onboarding-install/v1',nonce:'1'.repeat(64),machine_registry_id:machine.id,...common,image_id:'sha256:'+'c'.repeat(64),image:ONBOARDING_IMAGE,observed_at:new Date().toISOString(),intent_id:randomUUID(),pool:p.pool,installed:true,execution:false,os:'linux',resources:{cpu_cores:4,memory_total_bytes:8*2**30}};
 const old={id:oldId,created_by:'linux-pool-onboarding',payload:{linux_onboarding:{machine_registry_id:machine.id,parent_task_id:parent,revision:common.revision,artifact_digest:'2'.repeat(64),nonce:receipt.nonce,intent_id:receipt.intent_id,policy_json:JSON.stringify(p),installation_json:JSON.stringify({receipt,signature:createHmac('sha256',d.key).update(JSON.stringify(receipt)).digest('hex')})}}};
 const source={id:parent,status:'completed',payload:{node_onboarding:{id:machine.id,execution_task_id:id,request}}};
 const task={id,status:'in_progress',executor_kind:'linux-pool-controller',claimed_by:'linux-pool-onboarding',created_by:'linux-pool-onboarding',payload:{linux_onboarding:{machine_registry_id:machine.id,parent_task_id:parent,phase:'bootstrap',error:'linux_pool_ssh_unavailable',revision:'b'.repeat(40),artifact_digest:'3'.repeat(64),intent_id:randomUUID(),nonce:'4'.repeat(64),policy_json:JSON.stringify(p),credential_files:files,runtime_policy_digest:d.policyDigest,pool_policy_digest:pd.policyDigest,expected_version_id:null}}};
 const artifacts={capture:()=>({revision:'c'.repeat(40),digest:'5'.repeat(64)}),read:(revision,digest)=>{expect(digest).toBe(revision==='a'.repeat(40)?'2'.repeat(64):'3'.repeat(64));return {revision,files:{'linux-pool-installer.cjs':'installer','linux-pool-server.cjs':'source'},program:'fixed'};}};
 const db={query:async(sql,args)=>sql.includes('FROM tasks')?{rows:[args[0]===oldId?old:source],rowCount:1}:sql.includes('current_version_id')?{rows:[],rowCount:0}:{rows:[],rowCount:0}};
 const deps={artifacts,readRuntime:async()=>d,readPool:async()=>pd};return {machine,task,source,old,d,pd,deps,db};
}
it('只从持久原intent、私有部署和固定工件构造升级合同；原预算逐字保留',async()=>{
 const x=setup(),before=structuredClone(x.task),r=await createBootstrapRecovery(x.deps).prepare(x.db,x.task,x.source,x.machine);
 expect(x.task).toEqual(before);expect(r.intent_id).not.toBe(before.payload.linux_onboarding.intent_id);expect(r.policy_json).toBe(before.payload.linux_onboarding.policy_json);
 const u=JSON.parse(r.upgrade_json);expect(u).toMatchObject({schema_version:1,intent_id:r.intent_id,revision:'a'.repeat(40),source_sha256:{'linux-pool-server.cjs':hash('source')}});
 expect(r.previous_attempt).toEqual({intent_id:before.payload.linux_onboarding.intent_id,binding:hash(JSON.stringify({machine_registry_id:x.machine.id,pool:JSON.parse(r.policy_json).pool,revision:'b'.repeat(40),sources:x.deps.artifacts.read('b'.repeat(40),'3'.repeat(64)).files}))});
 expect(r.revision).toBe('c'.repeat(40));expect(r.artifact_digest).toBe('5'.repeat(64));expect(r.error).toBeNull();
 expect(JSON.stringify(r)).not.toContain(x.d.key);expect(JSON.stringify(r)).not.toContain(x.d.workerToken);
});
it.each(['kind','phase','claim','source','policy','runtime_digest','pool_digest','old_machine','old_receipt','artifact','same_revision'])('拒绝不完整%s，不捕获新意图',async kind=>{
 const x=setup(),s=x.task.payload.linux_onboarding;let capture=0;const captureArtifact=x.deps.artifacts.capture;x.deps.artifacts.capture=()=>{capture++;return captureArtifact();};
 if(kind==='kind')x.task.executor_kind='headed';if(kind==='phase')s.phase='script_prepare';if(kind==='claim')x.task.claimed_by='other';
 if(kind==='source')x.source.payload.node_onboarding.execution_task_id=randomUUID();if(kind==='policy')s.policy_json='{}';
 if(kind==='runtime_digest')s.runtime_policy_digest='0'.repeat(64);if(kind==='pool_digest')s.pool_policy_digest='0'.repeat(64);
 if(kind==='old_machine')x.old.payload.linux_onboarding.machine_registry_id=randomUUID();if(kind==='old_receipt')x.old.payload.linux_onboarding.installation_json='{}';
 if(kind==='artifact')x.deps.artifacts.read=()=>{throw Error('missing');};if(kind==='same_revision')x.deps.artifacts.capture=()=>({revision:s.revision,digest:s.artifact_digest});
 await expect(createBootstrapRecovery(x.deps).prepare(x.db,x.task,x.source,x.machine)).rejects.toThrow();if(kind!=='same_revision')expect(capture).toBe(0);
});

it('每次远端升级前重新读取私有合同；授权后漂移拒绝，禁止只信task内缓存',async()=>{
 const x=setup(),recovery=createBootstrapRecovery(x.deps),state=await recovery.prepare(x.db,x.task,x.source,x.machine),originalRead=x.deps.artifacts.read;
 x.deps.artifacts.read=(revision,digest)=>revision===state.revision?{revision,digest,files:{}}:originalRead(revision,digest);
 const upgraded={...x.task,payload:{linux_onboarding:state}};
 await expect(recovery.authorize(x.db,upgraded,x.source,x.machine)).resolves.toBeUndefined();
 x.d.expected.host_boot_id=randomUUID();await expect(recovery.authorize(x.db,upgraded,x.source,x.machine)).rejects.toThrow();
});
it.each(['reservation','node','grant','runtime'])('升级合同前拒绝真实资源状态%s，原意图不改',async kind=>{
 const x=setup(),query=x.db.query;x.db.query=async(sql,args)=>{
  if(kind==='reservation'&&sql.includes('capacity_reservations'))return {rowCount:1,rows:[{}]};
  if(kind==='node'&&sql.includes('current_version_id'))return {rowCount:1,rows:[{current_version_id:randomUUID()}]};
  if(kind==='grant'&&sql.includes('execution_grants'))return {rowCount:1,rows:[{}]};
  if(kind==='runtime'&&sql.includes('linux_script_authorizations'))return {rows:[{state:'revoked',status:'archived',payload:{},result:{}}]};
  return query(sql,args);
 };
 await expect(createBootstrapRecovery(x.deps).prepare(x.db,x.task,x.source,x.machine)).rejects.toThrow();
});

function installedSetup(){
 const x=setup(),s=x.task.payload.linux_onboarding,old=x.old.payload.linux_onboarding;
 Object.assign(s,{...old,phase:'renew_wait',error:null,upgrade_json:JSON.stringify({schema_version:1,intent_id:old.intent_id}),previous_attempt:{intent_id:randomUUID(),binding:'6'.repeat(64)},last_cleanup_runtime_id:randomUUID(),runtime_json:null});
 x.d.parent_task_id=x.task.id;x.source.payload.node_onboarding.execution_task_id=x.task.id;
 x.machine.metadata.onboarding={execution_task_id:x.task.id};
 const eid=randomUUID(),version=randomUUID(),grant=randomUUID(),nonce='9'.repeat(64),now=new Date().toISOString(),reservation=randomUUID();
 const profile=x.d.profiles.shell.profile,pdigest=hash(JSON.stringify(profile)),job={profile:'shell',cmd:`printf '%s\\n' '${nonce}:shell'; sleep 8`,timeout_sec:20,env:{}};
 const identity={reservation_id:reservation,intent_id:randomUUID(),launch_generation:1,machine_id:x.machine.name,owner_key:`script-${reservation}-a1`,config_digest:hash(JSON.stringify({job,profile_digest:pdigest})),worker_id:x.machine.name,worker_boot_id:x.d.expected.worker_boot_id,execution_version_id:version,execution_grant_id:grant,profile_id:'shell'};
 const receipt={schema_version:'linux-script-canary-cleanup/v1',nonce,machine_id:x.machine.name,...x.d.expected,execution_version_id:version,started_at:now,completed_at:now,execution:false,cleanup_confirmed:true,cases:[{identity,profile_digest:pdigest,container_id:'8'.repeat(64),not_started:false,cleanup:{...identity,container_id:'8'.repeat(64),challenge:randomUUID(),status:'cleaned',absent:true,tombstoned:true}}]};
 const row={id:s.last_cleanup_runtime_id,machine_registry_id:x.machine.id,evidence_task_id:eid,expected_version_id:null,execution_version_id:version,state:'revoked',policy_digest:x.d.policyDigest,nonce,created_at:now,grant_ids:{shell:grant},signed_payload:null,
  evidence_status:'archived',evidence_parent_task_id:x.task.id,evidence_kind:'linux-pool-controller',evidence_created_by:'linux-pool-onboarding',evidence_payload:{machine_registry_id:x.machine.id,linux_script_runtime_id:s.last_cleanup_runtime_id,linux_runtime_retired:s.last_cleanup_runtime_id},evidence_result:{actor:'linux-pool-onboarding',evidence:{receipt,signature:createHmac('sha256',x.d.key).update(JSON.stringify(receipt)).digest('hex')}}};
 row.evidence_result.evidence.envelope_json=JSON.stringify({receipt,signature:row.evidence_result.evidence.signature});
 const query=x.db.query;x.db.query=async(sql,args)=>{
  if(sql.includes('a.*,t.'))return {rows:args[0]===row.id?[row]:[],rowCount:args[0]===row.id?1:0};
  if(sql.includes('SELECT * FROM tasks'))return {rows:[x.task],rowCount:1};
  return query(sql,args);
 };
 return {...x,row,receipt};
}
it('已安装且签名清理的接续保原任务全字节，绑定包含上一层upgrade意图',async()=>{
 const x=installedSetup(),before=structuredClone(x.task),s=x.task.payload.linux_onboarding;
 const next=await createBootstrapRecovery(x.deps).prepareInstalled(x.db,x.task,x.source,x.machine);
 expect(x.task).toEqual(before);expect(next).toMatchObject({phase:'bootstrap',resume_of_task_id:x.task.id,upgrade_cleanup_runtime_id:x.row.id,policy_json:s.policy_json,expected_version_id:s.expected_version_id});
 expect(next.installation_json).toBeUndefined();expect(next.last_cleanup_runtime_id).toBeUndefined();expect(next.runtime_json).toBeUndefined();
 expect(next.previous_attempt).toEqual({intent_id:s.intent_id,binding:hash(JSON.stringify({machine_registry_id:x.machine.id,pool:JSON.parse(s.policy_json).pool,revision:s.revision,sources:x.deps.artifacts.read(s.revision,s.artifact_digest).files,upgrade:JSON.parse(s.upgrade_json),previous_attempt:s.previous_attempt}))});
 expect(next.intent_id).not.toBe(s.intent_id);expect(next.revision).toBe('c'.repeat(40));
});
it.each(['missing_marker','phase','runtime','source_pointer','registry_pointer','private_parent','machine','evidence_parent','evidence_kind','explicit_revoke','retire','signature','nonce','tombstone','policy','expected_version'])('已安装接续拒绝%s且零捕获新工件',async kind=>{
 const x=installedSetup(),s=x.task.payload.linux_onboarding;let captures=0;x.deps.artifacts.capture=()=>{captures++;throw Error('must not capture');};
 if(kind==='missing_marker')delete s.last_cleanup_runtime_id;if(kind==='phase')s.phase='script_canary';if(kind==='runtime')s.runtime_json='{}';
 if(kind==='source_pointer')x.source.payload.node_onboarding.execution_task_id=randomUUID();if(kind==='registry_pointer')x.machine.metadata.onboarding.execution_task_id=randomUUID();
 if(kind==='private_parent')x.d.parent_task_id=randomUUID();if(kind==='machine')x.row.machine_registry_id=randomUUID();if(kind==='evidence_parent')x.row.evidence_parent_task_id=randomUUID();
 if(kind==='evidence_kind')x.row.evidence_kind='headed-session';if(kind==='explicit_revoke')x.row.evidence_payload.linux_runtime_revoked=true;
 if(kind==='retire')x.row.evidence_payload.linux_runtime_retired=randomUUID();if(kind==='signature')x.row.evidence_result.evidence.signature='0'.repeat(64);
 if(kind==='nonce')x.row.nonce='0'.repeat(64);if(kind==='tombstone'){x.receipt.cases[0].cleanup.absent=false;x.row.evidence_result.evidence.signature=createHmac('sha256',x.d.key).update(JSON.stringify(x.receipt)).digest('hex');}
 if(kind==='policy')x.row.policy_digest='0'.repeat(64);if(kind==='expected_version')x.row.expected_version_id=randomUUID();
 await expect(createBootstrapRecovery(x.deps).prepareInstalled(x.db,x.task,x.source,x.machine)).rejects.toThrow('linux_pool_bootstrap_recovery_unconfirmed');expect(captures).toBe(0);
});
it('接续棒每次SSH前重验旧归档、cleanup和完整旧binding，未知不能靠新payload自证',async()=>{
 const x=installedSetup(),recovery=createBootstrapRecovery(x.deps),next=await recovery.prepareInstalled(x.db,x.task,x.source,x.machine);
 const id=randomUUID(),old=structuredClone(x.task),read=x.deps.artifacts.read;
 x.deps.artifacts.read=(rev,digest)=>rev===next.revision?{revision:rev,digest,files:{}}:read(rev,digest);
 Object.assign(x.task,{status:'archived',result:{actor:'linux-pool-onboarding',evidence:{continuation_task_id:id}}});
 x.source.payload.node_onboarding.execution_task_id=id;x.machine.metadata.onboarding.execution_task_id=id;
 const child={id,status:'in_progress',executor_kind:'linux-pool-controller',created_by:'linux-pool-onboarding',claimed_by:'linux-pool-onboarding',payload:{linux_onboarding:next}};
 await expect(recovery.authorize(x.db,child,x.source,x.machine)).resolves.toBeUndefined();
 next.previous_attempt.binding='0'.repeat(64);await expect(recovery.authorize(x.db,child,x.source,x.machine)).rejects.toThrow('linux_pool_bootstrap_recovery_unconfirmed');
 next.previous_attempt.binding=hash(JSON.stringify({machine_registry_id:x.machine.id,pool:JSON.parse(old.payload.linux_onboarding.policy_json).pool,revision:old.payload.linux_onboarding.revision,sources:read(old.payload.linux_onboarding.revision,old.payload.linux_onboarding.artifact_digest).files,upgrade:JSON.parse(old.payload.linux_onboarding.upgrade_json),previous_attempt:old.payload.linux_onboarding.previous_attempt}));
 const marker=next.upgrade_cleanup_runtime_id;delete next.upgrade_cleanup_runtime_id;await expect(recovery.authorize(x.db,child,x.source,x.machine)).rejects.toThrow('linux_pool_bootstrap_recovery_unconfirmed');next.upgrade_cleanup_runtime_id=marker;
 x.row.evidence_result.evidence.signature='0'.repeat(64);await expect(recovery.authorize(x.db,child,x.source,x.machine)).rejects.toThrow('linux_pool_bootstrap_recovery_unconfirmed');
});
