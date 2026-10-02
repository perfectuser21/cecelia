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
