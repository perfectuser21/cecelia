import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
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
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
  const response=await fetchFn(`${new URL(endpoint).origin}${route}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({...body,request_nonce:nonce}),signal:controller.signal}).catch(()=>{throw Error(controller.signal.aborted?'appserver_worker_response_timeout':'appserver_worker_unavailable');});
  const raw=await readBounded(response,controller);
  if(!response.ok&&response.status!==429)throw Error(`appserver_worker_http_${response.status}`);
  let envelope;try{envelope=JSON.parse(raw);}catch{throw Error('appserver_worker_receipt_unverified');}
  const signature=createHmac('sha256',token).update(JSON.stringify(envelope.receipt??null)).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(envelope.signature??'')||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature))
   ||envelope.receipt?.request_nonce!==nonce||envelope.receipt.machine_id!==machine
   ||(response.status===429&&envelope.receipt.status!=='waiting_resources'))throw Error('appserver_worker_receipt_unverified');
  return {authenticated:true,receipt:envelope.receipt};
  }finally{clearTimeout(timer);}
 }
 const operation=(id,action)=>store.withOperation(id,action,async(row,url)=>{
  const body=workerIdentity(row);
  if(action==='cancel')Object.assign(body,{container_id:row.container_id,challenge:row.cleanup_challenge});
  const verified=await request(url,row.machine_id,action,body);
  if(!receiptMatches(row,verified.receipt))throw Error('appserver_worker_identity_mismatch');
  return verified;
 });
 return Object.freeze({
  capabilities:async(home,machine)=>authorize(pool,{snapshotVersion:directory.current()?.version,machineId:machine,surface:'app_server',provider:home.provider,account:home.account,repo:home.repo,profileId:home.profile},
   async auth=>(await request(auth.node.endpoints.worker,machine,'capabilities')).receipt),
  start:id=>operation(id,'start'),inspect:id=>operation(id,'inspect'),cancel:id=>operation(id,'cancel'),
 });
}
