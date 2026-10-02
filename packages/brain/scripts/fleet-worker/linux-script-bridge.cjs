'use strict';
const http=require('node:http');
const path=require('node:path');
const {createHmac}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ACTIONS=['start','inspect','cancel'];
const MAX_REQUEST=65536,MAX_RESPONSE=131072;
const fail=code=>{throw Error('linux_script_bridge_'+code);};
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
function readBody(request) {
 return new Promise((resolve,reject)=>{
  const chunks=[];let size=0,done=false;
  const stop=error=>{if(done)return;done=true;reject(error);};
  request.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>MAX_REQUEST){stop(Object.assign(Error(),{status:413}));return;}chunks.push(chunk);});
  request.on('error',()=>stop(Object.assign(Error(),{status:400})));
  request.on('end',()=>{if(done)return;done=true;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Object.assign(Error(),{status:400}));}});
 });
}
// runtime再次校验独立Brain许可；Unix访问权与Worker.token本身均无执行权。
function createLinuxScriptBridge({key,runtime}) {
 if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||!runtime)fail('configuration_invalid');
 let active=0;
 const server=http.createServer({maxHeaderSize:4096,requestTimeout:5000,headersTimeout:5000,connectionsCheckingInterval:250},async(request,response)=>{
  let admitted=false;
  try {
   if(!ACTIONS.some(a=>request.url==='/'+a)){request.resume();json(response,404,{error:'linux_script_bridge_route_invalid'});return;}
   if(request.method!=='POST'){request.resume();json(response,405,{error:'linux_script_bridge_method_invalid'});return;}
   if(active>=8){request.resume();json(response,503,{error:'linux_script_bridge_busy'});return;}
   active++;admitted=true;
   const body=await readBody(request);
   if(!body||typeof body!=='object'||Array.isArray(body)||!UUID.test(body.request_nonce??'')){json(response,400,{error:'linux_script_bridge_body_invalid'});return;}
   const result=await runtime[request.url.slice(1)](body);
   const {permit:unused,...safe}=result;
   const receipt={...safe,request_nonce:body.request_nonce},signature=createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex');
   if(Buffer.byteLength(JSON.stringify({receipt,signature}))>MAX_RESPONSE)fail('response_oversized');
   json(response,receipt.status==='waiting_resources'?429:200,{receipt,signature});
  }catch(error){request.resume();if(!response.destroyed)json(response,[400,413].includes(error.status)?error.status:409,{error:'linux_script_operation_unconfirmed'});}
  finally{if(admitted)active--;}
 });
 server.keepAliveTimeout=500;server.maxRequestsPerSocket=16;server.setTimeout(6000,socket=>socket.destroy());
 return server;
}
// 普通Worker只转发；不持有root签名密钥，也不解释执行证明。
function createLinuxScriptBridgeClient({socketPath='/run/cecelia-script/bridge.sock',timeoutMs=15000}={}) {
 if(!path.isAbsolute(socketPath)||socketPath.includes('\0')||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>20000)fail('configuration_invalid');
 function request(action,body) {
  const data=JSON.stringify(body);if(Buffer.byteLength(data)>MAX_REQUEST)fail('request_oversized');
  return new Promise((resolve,reject)=>{
   let done=false;const chunks=[];let size=0;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
   const request=http.request({socketPath,path:'/'+action,method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},response=>{
    response.on('data',chunk=>{size+=chunk.length;if(size>MAX_RESPONSE){finish(Error('linux_script_bridge_response_oversized'));response.destroy();request.destroy();return;}chunks.push(chunk);});
    response.on('error',()=>finish(Error('linux_script_bridge_unavailable')));
    response.on('end',()=>{
     if(![200,429].includes(response.statusCode)){finish(Error('linux_script_bridge_unavailable'));return;}
     try{finish(null,{status:response.statusCode,envelope:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}
     catch{finish(Error('linux_script_bridge_unavailable'));}
    });
   });
   const timer=setTimeout(()=>{finish(Error('linux_script_bridge_unavailable'));request.destroy();},timeoutMs);
   request.on('error',()=>finish(Error('linux_script_bridge_unavailable')));request.end(data);
  });
 }
 return Object.fromEntries(ACTIONS.map(action=>[action,body=>request(action,body)]));
}
module.exports={createLinuxScriptBridge,createLinuxScriptBridgeClient};
