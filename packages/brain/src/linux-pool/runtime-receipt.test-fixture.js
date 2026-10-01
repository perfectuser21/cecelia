import {createHmac,randomUUID} from 'node:crypto';
import fixtureModule from '../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import {normalizeRuntimeDeployment,runtimeDigest as hash} from './runtime-deployment.js';
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
