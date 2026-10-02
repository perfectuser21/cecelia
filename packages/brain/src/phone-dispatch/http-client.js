import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {digest} from './identity.js';
import {isPhoneHubBinding} from './http-binding.js';
import {credentialValid,verifyPhoneHubReceipt} from './http-receipt.js';
const MAX_BYTES=16384,observations=new WeakMap();
// Only the successful native HTTP branch below can create observation authority.
export function readPhoneCapacityObservation(value,binding){
 const evidence=observations.get(value);if(!evidence)throw Error('phone_capacity_observation_required');
 if(!isPhoneHubBinding(binding)||evidence.bindingDigest!==digest(binding))throw Error('phone_capacity_identity_mismatch');
 return evidence;
}
export function createPhoneHttpClient({token,timeoutMs=5000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('phone_http_deadline_invalid');
 async function read(operation,binding){
  if(!isPhoneHubBinding(binding)||!credentialValid(token))throw Error('phone_http_binding_unavailable');
  const nonce=randomUUID(),path=operation==='capabilities'?'/phones/capabilities':'/maintenance/status';
  const body=JSON.stringify({request_nonce:nonce,...(operation==='capabilities'?{machine_id:binding.physical.machine_id}:{})});
  try{
   const envelope=await new Promise((resolve,reject)=>{
    let settled=false,req,timer;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){req?.destroy();reject(error);}else resolve(value);};
    timer=setTimeout(()=>finish(Error('deadline')),timeoutMs);
    try{req=http.request(new URL(path,binding.http_endpoint),{method:'POST',agent:false,headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
     if(res.statusCode!==200){res.destroy();finish(Error('status'));return;}
     if(res.headers['content-length']!==undefined&&(!/^\d+$/.test(res.headers['content-length'])||Number(res.headers['content-length'])>MAX_BYTES)){res.destroy();finish(Error('size'));return;}
     let size=0;const chunks=[];
     res.on('data',chunk=>{size+=chunk.length;if(size>MAX_BYTES){res.destroy();finish(Error('size'));}else chunks.push(chunk);});
     res.on('aborted',()=>finish(Error('aborted')));res.on('error',()=>finish(Error('response')));
     res.on('end',()=>{try{finish(null,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(Error('json'));}});
    });
    req.on('error',()=>finish(Error('transport')));req.end(body);}catch{finish(Error('transport'));}
   });
   const receipt=verifyPhoneHubReceipt(envelope,{binding,token,nonce,operation});
   if(operation==='capabilities')observations.set(receipt,Object.freeze({bindingDigest:digest(binding),nonce,receivedAt:Date.now()}));
   return receipt;
  }catch{throw Error('phone_http_unconfirmed');}
 }
 const closed=async()=>{throw Error('phone_runtime_not_connected');};
 return Object.freeze({capabilities:b=>read('capabilities',b),maintenance:b=>read('maintenance',b),start:closed,inspect:closed,cancel:closed});
}
