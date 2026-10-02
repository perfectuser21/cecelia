import {createHmac,timingSafeEqual} from 'node:crypto';
import {HEX,UUID,exact,error} from './deployment.js';
import {runtimeDigest as hash} from './runtime-deployment.js';
const IDENTITY=['reservation_id','intent_id','launch_generation','machine_id','owner_key','config_digest','worker_id','worker_boot_id','execution_version_id','execution_grant_id','profile_id'];
/** 只可淘汰旧挑战后重新验收；schema故意不兼容任何activate入口。 */
export function verifyCleanupEnvelope(kind,envelope,challenge,d,now){
 try{
  const fail=()=>{throw Error();},script=kind==='script',r=envelope?.receipt,raw=JSON.stringify(r);
  if(!exact(envelope,['receipt','signature'])||!HEX.test(envelope.signature??'')||!raw||Buffer.byteLength(raw)>262144
   ||!timingSafeEqual(Buffer.from(envelope.signature,'hex'),createHmac('sha256',script?d.key:d.token).update(raw).digest()))fail();
  const keys=script?['machine_registry_id','pool_config_digest','revision','host_boot_id','worker_boot_id','daemon_id']:['machine_registry_id','config_digest','revision','host_boot_id','worker_boot_id','daemon_id','image_id'];
  if(!exact(r,['schema_version','nonce','machine_id',...keys,'started_at','completed_at','execution','cleanup_confirmed',...(script?['execution_version_id','cases']:['container_id','not_started'])])
   ||r.schema_version!==`linux-${script?'script':'pool'}-canary-cleanup/v1`||r.execution!==false||r.cleanup_confirmed!==true||r.nonce!==challenge.nonce
   ||r.machine_id!==(script?d.machine_id:d.expected.machine_id)||keys.some(k=>r[k]!==d.expected[k]))fail();
  const start=Date.parse(r.started_at),end=Date.parse(r.completed_at);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<new Date(challenge.created_at).getTime()-1000||end<start||end>now+1000)fail();
  if(!script){if(r.not_started===true?r.container_id!==null:r.not_started!==false||!HEX.test(r.container_id??''))fail();}
  else{
   if(r.execution_version_id!==challenge.execution_version_id||!Array.isArray(r.cases)||r.cases.length!==Object.keys(d.profiles).length)fail();
   const profiles=new Set(),ids=new Set();
   for(const c of r.cases){const i=c.identity,p=d.profiles[i?.profile_id],clean=c.cleanup;
    if(!exact(c,['identity','profile_digest','container_id','not_started','cleanup'])||!exact(i,IDENTITY)||!p||profiles.has(i.profile_id)||ids.has(i.reservation_id)
     ||!UUID.test(i.reservation_id??'')||!UUID.test(i.intent_id??'')||i.launch_generation!==1||i.owner_key!==`script-${i.reservation_id}-a1`
     ||i.machine_id!==d.machine_id||i.worker_id!==d.machine_id||i.worker_boot_id!==d.expected.worker_boot_id||i.execution_version_id!==r.execution_version_id
     ||i.execution_grant_id!==challenge.grant_ids[i.profile_id]||c.profile_digest!==hash(p.profile)||c.container_id!==null&&!HEX.test(c.container_id??''))fail();
    const job={profile:i.profile_id,cmd:`printf '%s\\n' '${r.nonce}:${i.profile_id}'; sleep 8`,timeout_sec:20,env:{}};
    if(i.config_digest!==hash({job,profile_digest:c.profile_digest}))fail();
    if(c.not_started===true){if(c.container_id!==null||clean!==null)fail();}
    else if(c.not_started!==false||!clean||IDENTITY.some(k=>clean[k]!==i[k])||clean.container_id!==c.container_id||clean.status!=='cleaned'||clean.absent!==true||clean.tombstoned!==true||!UUID.test(clean.challenge??''))fail();
    profiles.add(i.profile_id);ids.add(i.reservation_id);
   }
  }
  return {receipt:r,raw,signature:envelope.signature};
 }catch{throw error('linux_pool_cleanup_receipt_invalid');}
}
