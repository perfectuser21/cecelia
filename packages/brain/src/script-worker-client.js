import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { workerUrlsFromEnv } from './orchestrator/fleet-node/node-admission-client.js';

/** 只有认证响应能产生 authenticated 封套；HTTP缺失/超时/404从不算清理成功。 */
export function createScriptWorkerClient({env=process.env,urls=workerUrlsFromEnv(env),token=env.KERNEL_FLEET_BRIDGE_TOKEN,
  fetchFn=globalThis.fetch,timeoutMs=20_000}={}) {
  async function request(machine,action,body={}) {
    if(typeof token!=='string'||token.length<32||!urls[machine])throw new Error('script_worker_unconfigured');
    const url=new URL(urls[machine]);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('script_worker_url_invalid');
    const requestNonce=randomUUID();
    const endpoint=action==='capabilities'?'/scripts/capabilities':`/scripts/${body.reservation_id}/${action}`;
    const response=await fetchFn(`${url.origin}${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({...body,request_nonce:requestNonce}),signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok && response.status!==429)throw new Error(`script_worker_http_${response.status}`);
    const raw=await response.text();if(Buffer.byteLength(raw)>131072)throw new Error('script_worker_response_oversized');
    const envelope=JSON.parse(raw);
    const signature=createHmac('sha256',token).update(JSON.stringify(envelope.receipt)).digest('hex');
    if(typeof envelope.signature!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature)
      ||!timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature))
      ||envelope.receipt?.request_nonce!==requestNonce||envelope.receipt.machine_id!==machine)throw new Error('script_worker_receipt_unverified');
    if(response.status===429 && envelope.receipt.status!=='waiting_resources')throw new Error('script_worker_receipt_unverified');
    if(action!=='capabilities'&&['reservation_id','owner_key','intent_id','launch_generation','config_digest'].some(k=>body[k]!==envelope.receipt[k]))throw new Error('script_worker_identity_mismatch');
    return {authenticated:true,receipt:envelope.receipt};
  }
  return {capabilities:async(machine)=>(await request(machine,'capabilities')).receipt,
    start:(machine,body)=>request(machine,'start',body),inspect:(machine,body)=>request(machine,'inspect',body),
    cancel:(machine,body)=>request(machine,'cancel',body)};
}
