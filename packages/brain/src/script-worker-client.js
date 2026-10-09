import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { createScriptAuthority } from './execution-directory/script-authority.js';
import { createLinuxScriptAuthorization } from './linux-pool/script-authority.js';
async function readBoundedResponse(response) {
  if(!response.body)throw new Error('script_worker_response_missing');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>131072)throw new Error('script_worker_response_oversized');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}

/** 只有认证响应能产生 authenticated 封套；HTTP缺失/超时/404从不算清理成功。 */
export function createScriptWorkerClient({env=process.env,pool,authorizeRequest=createScriptAuthority({pool}),token=env.KERNEL_FLEET_BRIDGE_TOKEN,
  linuxAuthorization=createLinuxScriptAuthorization(),fetchFn=globalThis.fetch,timeoutMs=20_000}={}) {
  async function request(machine,action,body={}) {
    return authorizeRequest(machine,action,body,async(workerEndpoint,authority)=>{
    const linux=authority?.node?.platform==='linux';
    if(linux&&action==='capabilities')return {authenticated:true,receipt:linuxAuthorization.capabilities(machine,authority)};
    const requestNonce=randomUUID();
    const prepared=linux?await linuxAuthorization.prepare(machine,action,{...body,request_nonce:requestNonce},authority):
      {body:{...body,request_nonce:requestNonce},workerToken:token,responseKey:token};
    if(typeof prepared.workerToken!=='string'||prepared.workerToken.length<32||!workerEndpoint)throw new Error('script_worker_unconfigured');
    const url=new URL(workerEndpoint);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('script_worker_url_invalid');
    const endpoint=action==='capabilities'?'/scripts/capabilities':`/scripts/${body.reservation_id}/${action}`;
    const response=await fetchFn(`${url.origin}${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${prepared.workerToken}`},
      body:JSON.stringify(prepared.body),signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok && response.status!==429)throw new Error(`script_worker_http_${response.status}`);
    const raw=await readBoundedResponse(response);
    const envelope=JSON.parse(raw);
    const signature=createHmac('sha256',prepared.responseKey).update(JSON.stringify(envelope.receipt)).digest('hex');
    if(typeof envelope.signature!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature)
      ||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature))
      ||envelope.receipt?.request_nonce!==requestNonce||envelope.receipt.machine_id!==machine)throw new Error('script_worker_receipt_unverified');
    if(response.status===429 && envelope.receipt.status!=='waiting_resources')throw new Error('script_worker_receipt_unverified');
    if(action!=='capabilities'&&['reservation_id','owner_key','intent_id','launch_generation','config_digest'].some(k=>body[k]!==envelope.receipt[k]))throw new Error('script_worker_identity_mismatch');
    if(linux&&['execution_version_id','execution_grant_id','profile_id','worker_id','worker_boot_id'].some(k=>prepared.body[k]!==envelope.receipt[k]))throw new Error('script_worker_identity_mismatch');
    return {authenticated:true,receipt:envelope.receipt};
    });
  }
  return {capabilities:async(machine)=>(await request(machine,'capabilities')).receipt,
    start:(machine,body)=>request(machine,'start',body),inspect:(machine,body)=>request(machine,'inspect',body),
    cancel:(machine,body)=>request(machine,'cancel',body)};
}
