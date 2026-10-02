#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),http=require('node:http'),https=require('node:https'),os=require('node:os'),path=require('node:path');
const {pipeline}=require('node:stream');
const {randomUUID}=require('node:crypto');
const {createJsonlBoundary}=require('./app-server-stream.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function endpoint(raw){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('appserver_shim_config_invalid');return u;}
function parseConfig(raw){
 // JSON.parse 的 last-wins 会掩盖重复授权字段；在已验证的 JSON token 上逐对象拒绝重复键。
 let value;try{value=JSON.parse(raw);}catch{throw Error('appserver_shim_config_invalid');}
 const tokens=raw.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]/g)??[],stack=[];
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];
  if(token==='{')stack.push(new Set());else if(token==='[')stack.push(null);
  else if(token==='}'||token===']')stack.pop();
  else if(token.startsWith('"')&&tokens[i+1]===':'){
   const keys=stack.at(-1),key=JSON.parse(token);
   if(!keys||keys.has(key))throw Error('appserver_shim_config_invalid');keys.add(key);
  }
 }
 return value;
}
const validHome=id=>typeof id==='string'&&/^chat-[a-z0-9-]{1,80}$/.test(id);
const canonicalHome=value=>typeof value==='string'&&value.length<=4096&&value.startsWith('/')&&value!=='/'
 &&!value.endsWith('/')&&value.trim()===value&&!/[\x00-\x1f\x7f*?\[\]{}\\]/.test(value)&&path.posix.normalize(value)===value;
function selectHome(c,env){
 const single=Object.hasOwn(c,'homeId'),mapped=Object.hasOwn(c,'homeMap');
 if(single===mapped)throw Error('appserver_shim_config_invalid');
 if(single){if(!validHome(c.homeId))throw Error('appserver_shim_config_invalid');return c;}
 if(!Array.isArray(c.homeMap)||!c.homeMap.length||c.homeMap.length>128)throw Error('appserver_shim_config_invalid');
 const paths=new Set(),homes=new Set();
 for(const entry of c.homeMap){
  if(!entry||Array.isArray(entry)||Object.keys(entry).some(k=>!['codexHome','homeId'].includes(k))
   ||!canonicalHome(entry.codexHome)||!validHome(entry.homeId)||paths.has(entry.codexHome)||homes.has(entry.homeId))throw Error('appserver_shim_config_invalid');
  paths.add(entry.codexHome);homes.add(entry.homeId);
 }
 // 只查受信配置，不读取或规范化环境路径指向的文件，也不从HOME/其他环境变量推断授权。
 const selected=canonicalHome(env.CODEX_HOME)&&c.homeMap.find(entry=>entry.codexHome===env.CODEX_HOME);
 if(!selected)throw Error('appserver_shim_home_unmapped');
 const {homeMap,...config}=c;return {...config,homeId:selected.homeId};
}
function loadShimConfig(filename,env=process.env){
 let fd;try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch{throw Error('appserver_shim_config_untrusted');}
 try{const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o077)!==0||(st.uid!==0&&st.uid!==process.getuid?.())||st.size>65536)throw Error('appserver_shim_config_untrusted');
  const c=parseConfig(fs.readFileSync(fd,'utf8'));if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['brainUrl','internalToken','homeId','homeMap','requestKey'].includes(k))||typeof c.brainUrl!=='string'||typeof c.internalToken!=='string'||c.internalToken.length<32||(c.requestKey!==undefined&&(typeof c.requestKey!=='string'||!UUID.test(c.requestKey))))throw Error('appserver_shim_config_invalid');
  if(endpoint(c.brainUrl).pathname!=='/')throw Error('appserver_shim_config_invalid');return Object.freeze(selectHome(c,env));
 }finally{fs.closeSync(fd);}
}
function control(config,route,body){
 return new Promise((resolve,reject)=>{
  const url=endpoint(config.brainUrl);url.pathname='/api/brain/internal/app-server'+route;
  const transport=url.protocol==='https:'?https:http;let settled=false;
  const request=transport.request(url,{method:'POST',headers:{'x-cecelia-token':config.internalToken,'content-type':'application/json'}},response=>{
   const chunks=[];let bytes=0;
   response.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>131072){finish(Error('appserver_control_response_oversized'));request.destroy();}else chunks.push(chunk);});
   response.on('error',()=>finish(Error('appserver_control_unconfirmed')));
   response.on('end',()=>{if(settled)return;try{const value=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
    if(response.statusCode!==200)throw Error(/^(appserver|execution)_[a-z_0-9]+$/.test(value.error)?value.error:'appserver_control_unconfirmed');
    finish(null,{value,token:response.headers['x-appserver-stream-token']});
   }catch(error){finish(Error(/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_control_unconfirmed'));}});
  });
  const timer=setTimeout(()=>{finish(Error('appserver_control_unconfirmed'));request.destroy();},20000);
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);}
  request.on('error',()=>finish(Error('appserver_control_unconfirmed')));request.end(JSON.stringify(body));
 });
}
async function runShim(config,input=process.stdin,output=process.stdout){
 // 旧静态配置字段仅兼容读取；每个物理连接生命周期使用一个新幂等键。
 const requestKey=randomUUID();
 const {value:g}=await control(config,'/generations',{home_id:config.homeId,request_key:requestKey});
 if(g.status!=='running'||!UUID.test(g.reservation_id))throw Error(g.status==='waiting_resources'?'appserver_waiting_resources':'appserver_generation_unavailable');
 const {value:stream,token}=await control(config,`/generations/${g.reservation_id}/stream`,{}),url=endpoint(stream.stream_url);
 if(!UUID.test(stream.stream_id)||url.pathname!==`/app-server-streams/${stream.stream_id}`||!/^[a-f0-9]{64}$/.test(token??'')||stream.expires_at<=Date.now())throw Error('appserver_stream_ticket_invalid');
 // 无任何自动重试；写后断链一律回报未知，由受管generation精确清理闭环。
 return new Promise((_resolve,reject)=>{
  let settled=false;const transport=url.protocol==='https:'?https:http;
  const request=transport.request(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/x-ndjson'}},response=>{
   clearTimeout(timer);if(response.statusCode!==200){response.destroy();finish(Error('appserver_stream_recovery_required'));return;}
   pipeline(response,createJsonlBoundary(),output,()=>finish());
   pipeline(input,createJsonlBoundary(),request,error=>{if(error)finish(Error('appserver_stream_unconfirmed'));});
  });
  const timer=setTimeout(()=>finish(Error('appserver_stream_unconfirmed')),6000);
  function finish(){if(settled)return;settled=true;clearTimeout(timer);request.destroy();reject(Error('appserver_stream_recovery_required'));}
  request.on('error',()=>finish(Error('appserver_stream_unconfirmed')));request.flushHeaders();
 });
}
if(require.main===module){
 const configPath=process.env.CECELIA_APP_SERVER_SHIM_CONFIG??path.join(os.homedir(),'.config/cecelia/app-server-shim.json');
 Promise.resolve().then(()=>runShim(loadShimConfig(configPath))).catch(error=>{process.stderr.write((/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_shim_unavailable')+'\n');process.exitCode=1;});
}
module.exports={loadShimConfig,runShim};
