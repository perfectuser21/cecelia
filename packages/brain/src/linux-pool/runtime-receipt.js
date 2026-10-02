import {createHmac,timingSafeEqual} from 'node:crypto';
import {UUID,HEX,exact,error} from './deployment.js';
import {runtimeDigest as hash} from './runtime-deployment.js';
import {verifyPoolProofResources} from './receipt.js';
const IDENTITY=['reservation_id','intent_id','launch_generation','machine_id','owner_key','config_digest','worker_id','worker_boot_id','execution_version_id','execution_grant_id','profile_id'];
export function verifyRuntimeEnvelope(envelope,challenge,deployment,now){
 try{
  const fail=()=>{throw Error();},r=envelope?.receipt,raw=JSON.stringify(r),e=deployment.expected;
  if(!exact(envelope,['receipt','signature'])||!HEX.test(envelope.signature??'')||!raw||Buffer.byteLength(raw)>262144
   ||!timingSafeEqual(Buffer.from(envelope.signature,'hex'),createHmac('sha256',deployment.key).update(raw).digest()))fail();
  if(r.schema_version!=='linux-script-canary/v1'||r.execution!==false||r.script_adapter_verified!==true||r.cleanup_confirmed!==true
   ||r.nonce!==challenge.nonce||r.execution_version_id!==challenge.execution_version_id||r.machine_id!==deployment.machine_id
   ||Object.entries(e).some(([k,v])=>r[k]!==v)||!Array.isArray(r.cases)||r.cases.length!==Object.keys(deployment.profiles).length)fail();
  const start=Date.parse(r.started_at),end=Date.parse(r.completed_at);
  if(![start,end].every(Number.isFinite)||start<new Date(challenge.created_at).getTime()-1000||end<start||end>now+1000||now-end>300000)fail();
  const profiles=new Set(),reservations=new Set(),containers=new Set();
  for(const c of r.cases){
   const i=c.identity,p=c.proof,t=c.terminal,clean=c.cleanup,id=i?.profile_id,entry=deployment.profiles[id];
   if(!exact(i,IDENTITY)||!entry||profiles.has(id)||reservations.has(i.reservation_id)||containers.has(c.container_id)
    ||!UUID.test(i.reservation_id??'')||!UUID.test(i.intent_id??'')||i.launch_generation!==1||i.owner_key!==`script-${i.reservation_id}-a1`
    ||i.machine_id!==deployment.machine_id||i.worker_id!==deployment.machine_id||i.worker_boot_id!==e.worker_boot_id
    ||i.execution_version_id!==r.execution_version_id||i.execution_grant_id!==challenge.grant_ids[id]
    ||c.profile_digest!==hash(entry.profile)||!HEX.test(c.container_id??''))fail();
   const job={profile:id,cmd:`printf '%s\\n' '${r.nonce}:${id}'; sleep 8`,timeout_sec:20,env:{}};
   if(i.config_digest!==hash({job,profile_digest:c.profile_digest})||p?.schema_version!=='linux-script-proof/v1'||p.execution!==false||p.script_verified!==true||p.pool_verified!==true
    ||hash(p.identity)!==hash(i)||p.profile_digest!==c.profile_digest||p.container_id!==c.container_id||p.config_digest!==e.pool_config_digest
    ||['machine_registry_id','host_boot_id','daemon_id'].some(k=>p[k]!==e[k]))fail();
   const observed=Date.parse(p.observed_at);if(!Number.isFinite(observed)||observed<start-1000||observed>end+1000)fail();
   verifyPoolProofResources(p,deployment.pool.pool);
   if(t?.exit_code!==0||t.timed_out!==false||t.stdout!==r.nonce+':'+id+'\n'||t.stderr!==''||!clean
    ||IDENTITY.some(k=>clean[k]!==i[k])||clean.container_id!==c.container_id||clean.status!=='cleaned'||clean.absent!==true||clean.tombstoned!==true||!UUID.test(clean.challenge??''))fail();
   profiles.add(id);reservations.add(i.reservation_id);containers.add(c.container_id);
  }
  return {receipt:r,raw,signature:envelope.signature};
 }catch{throw error('linux_pool_runtime_receipt_invalid');}
}
