import { createHmac,timingSafeEqual } from 'node:crypto';
import { HEX,error,exact } from './deployment.js';
export function verifyCanaryEnvelope(envelope,challenge,deployment,now){
 const fail=()=>{throw error('linux_pool_receipt_invalid');};
 if(!exact(envelope,['receipt','signature'])||!HEX.test(envelope.signature??''))fail();
 const r=envelope.receipt,raw=JSON.stringify(r);if(!raw||Buffer.byteLength(raw)>32768)fail();
 if(!timingSafeEqual(Buffer.from(envelope.signature,'hex'),createHmac('sha256',deployment.token).update(raw).digest()))fail();
 const e=deployment.expected;
 if(!r||r.schema_version!=='linux-pool-canary/v1'||r.nonce!==challenge.nonce||r.execution!==false||r.pool_verified!==true||r.cleanup_confirmed!==true
  ||!HEX.test(r.container_id??'')||['machine_registry_id','machine_id','revision','config_digest','host_boot_id','worker_boot_id','daemon_id','image_id'].some(k=>r[k]!==e[k]))fail();
 const start=Date.parse(r.started_at),end=Date.parse(r.completed_at),observed=Date.parse(r.proof?.observed_at);
 if(![start,end,observed].every(Number.isFinite)||start<new Date(challenge.created_at).getTime()-1000||end<start||end>now+1000||now-end>300000||observed<start-1000||observed>end+1000)fail();
 const p=r.proof;
 if(!p||p.schema_version!=='linux-pool-proof/v1'||p.pool_verified!==true||p.execution!==false
  ||['machine_registry_id','config_digest','host_boot_id','daemon_id','container_id'].some(k=>p[k]!==r[k]))fail();
 const positive=v=>Number.isFinite(v)&&v>0;
 if(p.cgroup_parent!=='cecelia-workloads.slice'||p.cgroup_parent_path!=='/cecelia.slice/cecelia-workloads.slice'
  ||!/^cgroup:\[\d+\]$/.test(p.host_cgroup_namespace??'')||!Number.isSafeInteger(p.container_pid)||p.container_pid<=1
  ||!/^\d+$/.test(p.container_start_time??'')||!positive(p.cpu_cores)||p.cpu_cores>e.pool.cpu_cores
  ||!Number.isSafeInteger(p.memory_limit_bytes)||!positive(p.memory_limit_bytes)||p.memory_limit_bytes>e.pool.memory_bytes
  ||!Number.isSafeInteger(p.memory_available_bytes)||!positive(p.memory_available_bytes)||p.memory_available_bytes>p.memory_limit_bytes
  ||!Number.isSafeInteger(p.pids_limit)||!positive(p.pids_limit)||p.pids_limit>e.pool.pids_limit
  ||!Number.isSafeInteger(p.pids_available)||!positive(p.pids_available)||p.pids_available>p.pids_limit
  ||!Number.isSafeInteger(p.disk_free_bytes)||!positive(p.disk_free_bytes)||!Number.isFinite(p.disk_used_percent)||p.disk_used_percent<0||p.disk_used_percent>=100)fail();
 return {receipt:r,raw,signature:envelope.signature};
}
