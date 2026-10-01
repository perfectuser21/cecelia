'use strict';
const contract=require('./app-server-contract.json');
const HOST_TOOLS=new Set(['exec','process','gateway_exec','gateway_process','node_exec','sandbox_exec','sandbox_process']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const idValid=v=>typeof v==='string'&&v.length>0&&v.length<=256||Number.isSafeInteger(v);
const key=id=>`${typeof id}:${id}`;
const deny=(id,code)=>({reply:{id,error:{code:-32600,message:code}}});
const filterTools=tools=>tools.filter(tool=>!hostTool(tool.name)).map(tool=>tool.type==='namespace'?{...tool,tools:filterTools(tool.tools)}:tool).filter(tool=>tool.type!=='namespace'||tool.tools.length);
const hostTool=name=>typeof name!=='string'||HOST_TOOLS.has(name.toLowerCase().split(/[./:]/).at(-1));
// 只支持固定生成物使用的 draft-07 关键字；执行步数/递归深度有界。
function valid(value,schema,definitions,{strict=false}={}){
 let steps=0;
 function check(v,s,depth=0,top=false){
  if(++steps>50000||depth>64)return false;
  if(typeof s==='boolean')return s;
  if(!s||typeof s!=='object')return false;
  if(s.$ref)return check(v,definitions[s.$ref.split('/').at(-1)],depth+1,top);
  if(s.allOf&&!s.allOf.every(x=>check(v,x,depth+1,top)))return false;
  if(s.anyOf&&!s.anyOf.some(x=>check(v,x,depth+1,top)))return false;
  if(s.oneOf&&s.oneOf.filter(x=>check(v,x,depth+1,top)).length!==1)return false;
  if(s.enum&&!s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v)))return false;
  if(s.type){const types=[].concat(s.type),matches=t=>t==='null'?v===null:t==='object'?object(v):t==='array'?Array.isArray(v):t==='integer'?Number.isSafeInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):typeof v===t;if(!types.some(matches))return false;}
  if(typeof v==='number'&&s.minimum!==undefined&&v<s.minimum)return false;
  if(typeof v==='string'&&s.minLength!==undefined&&Array.from(v).length<s.minLength)return false;
  if(Array.isArray(v)&&s.items&&!v.every(x=>check(x,s.items,depth+1)))return false;
  if(object(v)){
   if(s.required?.some(k=>!Object.hasOwn(v,k)))return false;
   for(const [k,x] of Object.entries(v)){
    if(Object.hasOwn(s.properties??{},k)){if(!check(x,s.properties[k],depth+1))return false;}
    else if(s.additionalProperties===false||top&&s.properties&&s.additionalProperties===undefined)return false;
    else if(object(s.additionalProperties)&&!check(x,s.additionalProperties,depth+1))return false;
   }
  }
  return true;
 }
 return check(value,schema,0,strict);
}
function createRpcPolicy({maxPending=128,maxIds=100000,accountId=null}={}){
 const clientPending=new Map(),serverPending=new Map(),usedClient=new Set(),usedServer=new Set();let closed=false;
 const checkOpen=()=>{if(closed)throw Error('appserver_rpc_closed');};
 function response(frame,pending,fromClient){
  const request=pending.get(key(frame.id));if(!request)throw Error('appserver_rpc_response_unknown');
  if(Object.hasOwn(frame,'result')===Object.hasOwn(frame,'error')||Object.keys(frame).some(k=>!['id','result','error','jsonrpc'].includes(k)))throw Error('appserver_rpc_response_invalid');
  if(fromClient&&request==='account/chatgptAuthTokens/refresh'&&!frame.error){
   const s=contract.responses.ChatgptAuthTokensRefreshResponse;
   if(!accountId||!valid(frame.result,s,s.definitions??{},{strict:true})||frame.result.chatgptAccountId!==accountId)throw Error('appserver_account_binding_denied');
  }
  pending.delete(key(frame.id));return {forward:frame};
 }
 function request(frame,kind,pending,used){
  const method=frame.method,set=contract[kind],schema=set.methods[method];
  if(!schema)return deny(frame.id,'appserver_rpc_method_denied');
  if(used.has(key(frame.id)))return deny(frame.id,'appserver_rpc_id_reused');
  if(used.size>=maxIds||pending.size>=maxPending)return deny(frame.id,'appserver_rpc_session_limit');
  if(!valid(frame.params??{},schema,set.definitions,{strict:true}))return deny(frame.id,'appserver_rpc_params_invalid');
  if(kind==='client'&&method==='account/login/start'&&(!accountId||frame.params.type!=='chatgptAuthTokens'||frame.params.chatgptAccountId!==accountId))return deny(frame.id,'appserver_account_binding_denied');
  if(kind==='server'&&method==='item/tool/call'&&(hostTool(frame.params.tool)||(frame.params.namespace!=null&&hostTool(frame.params.namespace))))return deny(frame.id,'appserver_host_tool_denied');
  if(kind==='client'&&method==='thread/start'&&frame.params.dynamicTools)frame={...frame,params:{...frame.params,dynamicTools:filterTools(frame.params.dynamicTools)}};
  used.add(key(frame.id));pending.set(key(frame.id),method);return {forward:frame};
 }
 function receive(frame,kind){
  checkOpen();if(!object(frame)||frame.jsonrpc!==undefined&&frame.jsonrpc!=='2.0')throw Error('appserver_rpc_frame_invalid');
  const hasId=Object.hasOwn(frame,'id');if(hasId&&!idValid(frame.id))throw Error('appserver_rpc_id_invalid');
  if(Object.hasOwn(frame,'method')){
   if(typeof frame.method!=='string'||Object.keys(frame).some(k=>!['id','method','params','jsonrpc'].includes(k)))throw Error('appserver_rpc_frame_invalid');
   if(!hasId){
    if(kind==='client'){if(frame.method!=='initialized'||frame.params!==undefined&&(!object(frame.params)||Object.keys(frame.params).length))throw Error('appserver_rpc_notification_denied');}
    else {const s=contract.notification.methods[frame.method];if(!s||!valid(frame.params??{},s,contract.notification.definitions))throw Error('appserver_rpc_notification_denied');}
    return {forward:frame};
   }
   return kind==='client'?request(frame,'client',clientPending,usedClient):request(frame,'server',serverPending,usedServer);
  }
  if(!hasId)throw Error('appserver_rpc_frame_invalid');
  return kind==='client'?response(frame,serverPending,true):response(frame,clientPending,false);
 }
 return Object.freeze({client:f=>receive(f,'client'),server:f=>receive(f,'server'),close(){closed=true;const uncertain=clientPending.size>0||serverPending.size>0;clientPending.clear();serverPending.clear();usedClient.clear();usedServer.clear();return {uncertain};}});
}
module.exports={createRpcPolicy,valid,hostTool};
