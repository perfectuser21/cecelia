'use strict';
const {createHash}=require('node:crypto');
const METHODS=Object.freeze(['initialize','model/list','config/read','configRequirements/read']);
const VERSION=require('./app-server-contract.json').version;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function validResult(method,result){
 if(!object(result))return false;
 if(method==='initialize')return typeof result.userAgent==='string'&&new RegExp(`(?:^|[ /])${VERSION.replaceAll('.','\\.')}\\b`).test(result.userAgent);
 if(method==='model/list')return Array.isArray(result.data);
 if(method==='config/read')return object(result.config);
 return Object.hasOwn(result,'requirements')&&(result.requirements===null||object(result.requirements));
}
// prepared 授权没有聊天执行权。流边界仅允许元数据验收，审计不保存响应正文。
function createCanaryPolicy(policy){
 const pending=new Map(),seen=new Set(),results=new Map();
 let rejected=0,failed=0,initialized=false,closed=false;
 const key=id=>`${typeof id}:${id}`;
 function deny(frame,reason){rejected++;return {reply:{id:frame.id,error:{code:-32600,message:reason}}};}
 function receive(frame,direction){
  if(closed)throw Error('appserver_rpc_closed');
  if(frame&&Object.hasOwn(frame,'method')){
   if(direction==='server'&&Object.hasOwn(frame,'id')||direction==='client'&&!METHODS.includes(frame.method)&&frame.method!=='initialized')return deny(frame,'appserver_canary_method_denied');
   if(direction==='client'){
    if(frame.method==='initialized'){
     if(initialized)return deny(frame,'appserver_canary_method_reused');
    }else{
     if(seen.has(frame.method))return deny(frame,'appserver_canary_method_reused');
     const p=frame.params;
     if(frame.method==='config/read'&&p&&Object.entries(p).some(([k,v])=>!(k==='cwd'&&v===null||k==='includeLayers'&&v===false))
      ||frame.method==='model/list'&&p&&Object.entries(p).some(([k,v])=>!(k==='limit'&&v===1||k==='cursor'&&v===null||k==='includeHidden'&&v===false)))return deny(frame,'appserver_canary_params_denied');
    }
   }
  }
  let output;try{output=policy[direction](frame);}catch(error){rejected++;throw error;}
  if(output.reply){rejected++;return output;}
  if(direction==='client'&&frame.method==='initialized')initialized=true;
  if(direction==='client'&&METHODS.includes(frame.method)){
   pending.set(key(frame.id),frame.method);seen.add(frame.method);
  }
  if(direction==='server'&&Object.hasOwn(frame,'id')&&!Object.hasOwn(frame,'method')){
   const method=pending.get(key(frame.id));pending.delete(key(frame.id));
   if(!method||frame.error||!validResult(method,frame.result)){failed++;}else results.set(method,createHash('sha256').update(JSON.stringify(frame.result)).digest('hex'));
  }
  return output;
 }
 return Object.freeze({client:frame=>receive(frame,'client'),server:frame=>receive(frame,'server'),
  canaryEvidence:()=>({complete:initialized&&rejected===0&&failed===0&&pending.size===0&&METHODS.every(m=>results.has(m)),rejected,failed,
   methods:METHODS.filter(m=>results.has(m)).map(method=>({method,result_digest:results.get(method)}))}),
  close(){closed=true;return policy.close();},
 });
}
module.exports={createCanaryPolicy};
