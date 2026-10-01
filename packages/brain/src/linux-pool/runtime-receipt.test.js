import {createHmac,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import fixtureModule from '../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import {normalizeRuntimeDeployment,runtimeDigest as hash} from './runtime-deployment.js';
import {verifyRuntimeEnvelope} from './runtime-receipt.js';
export function fixture(){
 const {record:r}=fixtureModule.fixture(),now=Date.now(),deployment=normalizeRuntimeDeployment({pool:r.pool,revision:'a'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:r.identity.worker_boot_id,daemon_id:r.daemon_id,
  profiles:{safe:{profile:r.profile,image_id:r.image_id}},worker_credential_file:'/etc/worker.token',execution_credential_file:'/etc/execution.key',parent_task_id:randomUUID()},'b'.repeat(64),'c'.repeat(64));
 const challenge={nonce:'d'.repeat(64),created_at:new Date(now-1000),execution_version_id:r.identity.execution_version_id,grant_ids:{safe:r.identity.execution_grant_id}};
 const identity={...r.identity,config_digest:hash({job:{profile:'safe',cmd:`printf '%s\\n' '${challenge.nonce}:safe'; sleep 8`,timeout_sec:20,env:{}},profile_digest:hash(r.profile)})},container='e'.repeat(64);
 const proof={schema_version:'linux-script-proof/v1',execution:false,pool_verified:true,script_verified:true,identity,profile_digest:hash(r.profile),
  machine_registry_id:r.pool.machine_registry_id,config_digest:deployment.expected.pool_config_digest,host_boot_id:deployment.expected.host_boot_id,daemon_id:r.daemon_id,container_id:container,
  observed_at:new Date(now).toISOString(),cgroup_parent:'cecelia-workloads.slice',cgroup_parent_path:'/cecelia.slice/cecelia-workloads.slice',host_cgroup_namespace:'cgroup:[123]',container_pid:456,container_start_time:'123456',
  cpu_cores:1,memory_limit_bytes:2**30,memory_available_bytes:2**29,pids_limit:128,pids_available:100,disk_free_bytes:2**30,disk_used_percent:20};
 const receipt={schema_version:'linux-script-canary/v1',nonce:challenge.nonce,...deployment.expected,machine_id:deployment.machine_id,execution_version_id:challenge.execution_version_id,
  execution:false,script_adapter_verified:true,cleanup_confirmed:true,started_at:new Date(now).toISOString(),completed_at:new Date(now).toISOString(),
  cases:[{identity,profile_digest:hash(r.profile),container_id:container,proof,terminal:{exit_code:0,timed_out:false,stdout:challenge.nonce+':safe\n',stderr:''},
   cleanup:{...identity,container_id:container,challenge:randomUUID(),status:'cleaned',absent:true,tombstoned:true}}]};
 const envelope=()=>({receipt,signature:createHmac('sha256',deployment.key).update(JSON.stringify(receipt)).digest('hex')});
 return {deployment,challenge,receipt,envelope,now};
}
it('root独立签名绑定完整版本/grant/profile、宿主proof、输出和取消墓碑',()=>{const f=fixture();expect(verifyRuntimeEnvelope(f.envelope(),f.challenge,f.deployment,f.now).receipt).toEqual(f.receipt);});
it('自报成功缺少任一身份/宿主/输出/精确清理或nonce时不得激活',()=>{
 for(const mutate of [r=>r.nonce='f'.repeat(64),r=>r.execution=true,r=>r.worker_boot_id=randomUUID(),r=>r.cases=[],r=>r.cases.push(r.cases[0]),
  r=>r.cases[0].identity.execution_grant_id=randomUUID(),r=>r.cases[0].profile_digest='f'.repeat(64),r=>r.cases[0].proof.cpu_cores=99,
  r=>r.cases[0].proof.identity={...r.cases[0].identity,intent_id:randomUUID()},r=>r.cases[0].terminal.stdout='ok',r=>r.cases[0].terminal.timed_out=true,
  r=>r.cases[0].cleanup.container_id='f'.repeat(64),r=>r.cases[0].cleanup.tombstoned=false,r=>r.completed_at='2000-01-01T00:00:00Z']){
  const f=fixture();mutate(f.receipt);expect(()=>verifyRuntimeEnvelope(f.envelope(),f.challenge,f.deployment,f.now)).toThrow('linux_pool_runtime_receipt_invalid');
 }
 const f=fixture(),e=f.envelope();e.signature=createHmac('sha256',f.deployment.workerToken).update(JSON.stringify(e.receipt)).digest('hex');
 expect(()=>verifyRuntimeEnvelope(e,f.challenge,f.deployment,f.now)).toThrow('linux_pool_runtime_receipt_invalid');
});
