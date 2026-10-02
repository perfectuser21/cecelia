import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {endpointValid} from './directory.js';
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const unconfirmed=()=>Error('execution_baseline_worker_unconfirmed');
export function verifyMaintenance(envelope,{token,nonce,machineId,nowMs=Date.now()}){
 const r=envelope?.receipt,signature=createHmac('sha256',token).update(JSON.stringify(r??null)).digest('hex');
 if(!HASH.test(envelope?.signature??'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature)))throw unconfirmed();
 const age=nowMs-Date.parse(r?.observed_at),counts=[r?.maintenance_pending??0,r?.in_flight_launches,r?.attempts?.pending,r?.scripts?.pending,r?.orchestrators?.preparing,r?.orchestrators?.prepared,r?.orchestrators?.running_processes,r?.app_servers?.pending];
 if(r?.schema_version!=='fleet-maintenance/v1'||r.machine_id!==machineId||r.request_nonce!==nonce||!UUID.test(r.boot_id??'')||!HASH.test(r.config_digest??'')
  ||!Number.isFinite(age)||age< -1000||age>5000||r.draining!==true||r.quiescent!==true||r.observation_stable!==true
  ||!Number.isSafeInteger(r.activity_revision)||r.activity_revision<0||counts.some(n=>n!==0))throw unconfirmed();
 return r;
}
export function verifyBaselineProof(envelope,{token,nonce,machineId,bootId,configDigest,image,os,versions,activityRevision,nowMs=Date.now()}){
 const r=envelope?.receipt,signature=createHmac('sha256',token).update(JSON.stringify(r??null)).digest('hex');
 if(!HASH.test(envelope?.signature??'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature)))throw unconfirmed();
 const age=nowMs-Date.parse(r?.observed_at);
 if(r?.schema_version!=='fleet-baseline-proof/v1'||r.machine_id!==machineId||r.request_nonce!==nonce||r.boot_id!==bootId||r.config_digest!==configDigest
  ||r.image_digest!==image||r.image_id!==image||r.os_version!==os||!Number.isFinite(age)||age< -1000||age>5000||!HASH.test(r.container_id??'')
  ||r.activity_revision_before!==activityRevision||!Number.isSafeInteger(r.activity_revision_after)||r.activity_revision_after!==activityRevision+4
  ||r.workspace_cleanup?.confirmed!==true||r.workspace_cleanup.absent!==true
  ||r.cleanup?.confirmed!==true||r.cleanup.absent!==true||r.cleanup.container_id!==r.container_id||r.tools?.workspace!==true||r.tools.sandbox!==true
  ||r.tools.node!==`v${versions.node}`||r.tools.git!==`git version ${versions.git}`||r.tools.codex!==`codex-cli ${versions.codex}`)throw unconfirmed();
 return r;
}
export function createBaselineEvidenceClient({token=process.env.KERNEL_FLEET_BRIDGE_TOKEN,fetchFn=globalThis.fetch,timeoutMs=10_000}={}){
 async function request(node,route,body){
  if(typeof token!=='string'||token.length<32||!endpointValid(node?.endpoints?.worker))throw unconfirmed();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(20_000,timeoutMs));let reader;
  try{
   const response=await fetchFn(`${new URL(node.endpoints.worker).origin}${route}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json',authorization:`Bearer ${token}`}:{},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
   if(!response.ok||Number(response.headers.get('content-length'))>65536)throw unconfirmed();
   reader=response.body.getReader();const chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536)throw unconfirmed();chunks.push(value);}
   return JSON.parse(Buffer.concat(chunks,length).toString('utf8'));
  }catch{controller.abort();reader?.cancel().catch(()=>{});throw unconfirmed();}finally{clearTimeout(timer);reader?.releaseLock();}
 }
 return {
  async maintenance(node){const nonce=randomUUID();return verifyMaintenance(await request(node,'/maintenance/status',{request_nonce:nonce}),{token,nonce,machineId:node.canonical_id});},
  async proof(node,{bootId,configDigest,os,activityRevision}){const nonce=randomUUID(),image=node.profile.runner_image_digest;return verifyBaselineProof(await request(node,'/maintenance/baseline-proof',{request_nonce:nonce,expected_activity_revision:activityRevision,expected_boot_id:bootId,expected_config_digest:configDigest,expected_image_digest:image}),{token,nonce,machineId:node.canonical_id,bootId,configDigest,image,os,activityRevision,versions:node.profile.version_policy});},
  health:node=>request(node,'/health'),
 };
}
