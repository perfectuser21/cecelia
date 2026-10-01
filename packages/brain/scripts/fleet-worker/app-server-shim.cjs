#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),http=require('node:http'),https=require('node:https'),os=require('node:os'),path=require('node:path');
const {pipeline}=require('node:stream');
const {createJsonlBoundary}=require('./app-server-stream.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function endpoint(raw){const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('appserver_shim_config_invalid');return u;}
function loadShimConfig(filename){
 let fd;try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}catch{throw Error('appserver_shim_config_untrusted');}
 try{const st=fs.fstatSync(fd);if(!st.isFile()||(st.mode&0o077)!==0||(st.uid!==0&&st.uid!==process.getuid?.())||st.size>65536)throw Error('appserver_shim_config_untrusted');
  const c=JSON.parse(fs.readFileSync(fd,'utf8'));if(!c||Object.keys(c).some(k=>!['brainUrl','internalToken','homeId','requestKey'].includes(k))||typeof c.internalToken!=='string'||c.internalToken.length<32||!/^chat-[a-z0-9-]{1,80}$/.test(c.homeId)||!UUID.test(c.requestKey))throw Error('appserver_shim_config_invalid');
  if(endpoint(c.brainUrl).pathname!=='/')throw Error('appserver_shim_config_invalid');return Object.freeze(c);
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
 const {value:g}=await control(config,'/generations',{home_id:config.homeId,request_key:config.requestKey});
 if(g.status!=='running'||!UUID.test(g.reservation_id))throw Error(g.status==='waiting_resources'?'appserver_waiting_resources':'appserver_generation_unavailable');
 const {value:stream,token}=await control(config,`/generations/${g.reservation_id}/stream`,{}),url=endpoint(stream.stream_url);
 if(!UUID.test(stream.stream_id)||url.pathname!==`/app-server-streams/${stream.stream_id}`||!/^[a-f0-9]{64}$/.test(token??'')||stream.expires_at<=Date.now())throw Error('appserver_stream_ticket_invalid');
 // 无任何自动重试；写后断链一律回报未知，由受管generation精确清理闭环。
 return new Promise((resolve,reject)=>{
  let settled=false;const transport=url.protocol==='https:'?https:http;
  const request=transport.request(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/x-ndjson'}},response=>{
   clearTimeout(timer);if(response.statusCode!==200){response.destroy();finish(Error('appserver_stream_recovery_required'));return;}
   pipeline(response,createJsonlBoundary(),output,error=>finish(error?Error('appserver_stream_unconfirmed'):undefined));
   pipeline(input,createJsonlBoundary(),request,error=>{if(error)finish(Error('appserver_stream_unconfirmed'));});
  });
  const timer=setTimeout(()=>finish(Error('appserver_stream_unconfirmed')),6000);
  function finish(error){if(settled)return;settled=true;clearTimeout(timer);request.destroy();if(error)reject(error);else resolve();}
  request.on('error',()=>finish(Error('appserver_stream_unconfirmed')));request.flushHeaders();
 });
}
if(require.main===module){
 const configPath=process.env.CECELIA_APP_SERVER_SHIM_CONFIG??path.join(os.homedir(),'.config/cecelia/app-server-shim.json');
 Promise.resolve().then(()=>runShim(loadShimConfig(configPath))).catch(error=>{process.stderr.write((/^(appserver|execution)_[a-z_0-9]+$/.test(error.message)?error.message:'appserver_shim_unavailable')+'\n');process.exitCode=1;});
}
module.exports={loadShimConfig,runShim};
