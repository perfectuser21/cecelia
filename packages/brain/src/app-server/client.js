import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {authorize} from '../execution-directory/store.js';
import {directory,endpointValid} from '../execution-directory/directory.js';
import {workerIdentity,receiptMatches} from './identity.js';
const MAX_RESPONSE_BYTES=131072;
function readChunk(reader,signal){
 return new Promise((resolve,reject)=>{
  const finish=(fn,value)=>{signal.removeEventListener('abort',aborted);fn(value);};
  const aborted=()=>finish(reject,Error('appserver_worker_response_timeout'));
  if(signal.aborted){aborted();return;}
  signal.addEventListener('abort',aborted,{once:true});
  reader.read().then(value=>finish(resolve,value),error=>finish(reject,error));
 });
}
async function readBounded(response,controller){
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks=[];let total=0;
 try{
  if(Number(response.headers.get('content-length'))>MAX_RESPONSE_BYTES)throw Error('appserver_worker_response_oversized');
  for(;;){const {done,value}=await readChunk(reader,controller.signal);if(done)break;
   total+=value.byteLength;if(total>MAX_RESPONSE_BYTES)throw Error('appserver_worker_response_oversized');
   chunks.push(value);
  }
  return Buffer.concat(chunks,total).toString('utf8');
 }catch(error){
  // 原始响应正文和底层错误不进入日志/任务；取消读取与中止网络都不等待对端。
  const code=['appserver_worker_response_oversized','appserver_worker_response_timeout'].includes(error.message)?error.message:'appserver_worker_response_unavailable';
  controller.abort();reader.cancel().catch(()=>{});throw Error(code);
 }finally{reader.releaseLock();}
}
export function createAppServerClient({pool,store,env=process.env,fetchFn=globalThis.fetch,timeoutMs=20_000}){
 const token=env.KERNEL_FLEET_BRIDGE_TOKEN;
 async function request(endpoint,machine,action,body={}){
  if(typeof token!=='string'||token.length<32||!endpointValid(endpoint))throw Error('appserver_worker_unconfigured');
  const nonce=randomUUID(),route=action==='capabilities'?'/app-servers/capabilities':`/app-servers/${body.reservation_id}/${action}`;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='prepare-stream'?Math.min(timeoutMs,6000):timeoutMs);
  try{
  const response=await fetchFn(`${new URL(endpoint).origin}${route}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({...body,request_nonce:nonce}),signal:controller.signal}).catch(()=>{throw Error(controller.signal.aborted?'appserver_worker_response_timeout':'appserver_worker_unavailable');});
  const raw=await readBounded(response,controller);
  if(!response.ok&&response.status!==429)throw Error(`appserver_worker_http_${response.status}`);
  let envelope;try{envelope=JSON.parse(raw);}catch{throw Error('appserver_worker_receipt_unverified');}
  const signature=createHmac('sha256',token).update(JSON.stringify(envelope.receipt??null)).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(envelope.signature??'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature))
   ||envelope.receipt?.request_nonce!==nonce||envelope.receipt.machine_id!==machine
   ||(response.status===429&&envelope.receipt.status!=='waiting_resources'))throw Error('appserver_worker_receipt_unverified');
  if(action==='prepare-stream'){
   const streamToken=response.headers.get('x-appserver-stream-token');
   if(!/^[a-f0-9]{64}$/.test(streamToken??'')||envelope.receipt.token_digest!==createHash('sha256').update(streamToken).digest('hex')
    ||envelope.receipt.stream_id!==body.stream_id||!Number.isFinite(envelope.receipt.expires_at)||envelope.receipt.expires_at<=Date.now()||envelope.receipt.expires_at>body.prepare_deadline)throw Error('appserver_worker_receipt_unverified');
   return {authenticated:true,receipt:envelope.receipt,streamToken};
  }
  return {authenticated:true,receipt:envelope.receipt,signature:envelope.signature};
  }finally{clearTimeout(timer);}
 }
 const operation=(id,action)=>store.withOperation(id,action,async(row,url)=>{
  if(action==='start'||action==='prepare-stream'){
   const caps=(await request(url,row.machine_id,'capabilities')).receipt;
   if(caps.worker_id!==row.worker_id||caps.worker_boot_id!==row.worker_boot_id||caps.profiles?.[row.config.profile]!==row.config_digest)throw Error('appserver_worker_configuration_mismatch');
  }
  const body=workerIdentity(row);
  if(action==='start'&&row.canary_authorization){
   const a=row.canary_authorization,payload={authorization_id:a.id,nonce:a.nonce,expires_at:Number(new Date(a.challenge_expires_at)),identity:{...body}};
   body.canary_permit={payload,signature:createHmac('sha256',token).update(JSON.stringify(payload)).digest('hex')};
  }
  if(action==='prepare-stream')Object.assign(body,{stream_id:row.stream.id,prepare_deadline:Number(new Date(row.stream.prepare_deadline))});
  if(action==='cancel')Object.assign(body,{container_id:row.container_id,challenge:row.cleanup_challenge});
  const verified=await request(url,row.machine_id,action,body);
  if(!receiptMatches(row,verified.receipt))throw Error('appserver_worker_identity_mismatch');
  if(action==='prepare-stream')return {token:verified.streamToken,stream_id:body.stream_id,stream_url:`${new URL(url).origin}/app-server-streams/${body.stream_id}`,expires_at:verified.receipt.expires_at};
  return verified;
 });
 return Object.freeze({
  probeCapabilities:async(machineRegistryId,expectedVersionId)=>{
   const node=(await pool.query(`SELECT v.*,n.canonical_id FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id
    JOIN system_registry r ON r.id=n.machine_registry_id WHERE n.machine_registry_id=$1 AND v.id=$2 AND v.state='active' AND r.type='machine' AND r.status='active'`,[machineRegistryId,expectedVersionId])).rows[0];
   if(!node)throw Error('appserver_authorization_node_unavailable');
   return (await request(node.endpoints.worker,node.canonical_id,'capabilities')).receipt;
  },
  capabilities:async(home,machine)=>authorize(pool,{snapshotVersion:directory.current()?.version,machineId:machine,surface:'app_server',provider:home.provider,account:home.account,repo:home.repo,profileId:home.profile},
   async auth=>(await request(auth.node.endpoints.worker,machine,'capabilities')).receipt),
  prepareStream:async id=>{await store.reserveStream(id);return operation(id,'prepare-stream');},
  start:id=>operation(id,'start'),inspect:id=>operation(id,'inspect'),cancel:id=>operation(id,'cancel'),
 });
}
