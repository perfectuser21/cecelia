import http from 'node:http';
import https from 'node:https';
import {endpointValid} from '../execution-directory/directory.js';
const requests=[
 {id:1,method:'initialize',params:{clientInfo:{name:'cecelia_canary',version:'1'},capabilities:{experimentalApi:true}}},
 {id:2,method:'model/list',params:{limit:1,includeHidden:false}},
 {id:3,method:'config/read',params:{includeLayers:false}},
 {id:4,method:'configRequirements/read'},
];
// 只驱动固定元数据协议；是否验收成功以Worker封存签名回执为准，不接受客户端自报。
export function runCanaryProtocol(ticket,{timeoutMs=25000}={}){
 return new Promise((resolve,reject)=>{
  let url;try{url=new URL(ticket.stream_url);}catch{return reject(Error('appserver_canary_ticket_invalid'));}
  if(!endpointValid(url.origin)||!/^\/app-server-streams\/[a-f0-9-]{36}$/.test(url.pathname)||url.search||url.hash
   ||!/^[a-f0-9]{64}$/.test(ticket.token??'')||ticket.expires_at<=Date.now())return reject(Error('appserver_canary_ticket_invalid'));
  let request,response,timer,done=false,pending='',bytes=0,index=0;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){response?.destroy();request?.destroy();reject(error);}else resolve({complete:true});};
  const fail=()=>finish(Error('appserver_canary_stream_unconfirmed'));
  const send=frame=>request.write(JSON.stringify(frame)+'\n');
  request=(url.protocol==='https:'?https:http).request(url,{method:'POST',headers:{authorization:`Bearer ${ticket.token}`,'content-type':'application/x-ndjson'},agent:false},res=>{
   response=res;if(res.statusCode!==200)return fail();
   res.setEncoding('utf8');res.on('error',fail);res.on('aborted',fail);
   res.on('data',chunk=>{
    if(done)return;bytes+=Buffer.byteLength(chunk);pending+=chunk;if(bytes>262144||Buffer.byteLength(pending)>65536)return fail();
    let end;while((end=pending.indexOf('\n'))>=0){
     let frame;try{frame=JSON.parse(pending.slice(0,end));}catch{return fail();}pending=pending.slice(end+1);
     if(index>=requests.length||frame.id!==requests[index].id||frame.method||frame.error||!frame.result||typeof frame.result!=='object')return fail();
     index++;if(index===1)send({method:'initialized'});
     if(index<requests.length)send(requests[index]);else request.end();
    }
   });
   res.on('end',()=>{if(pending.length||index!==requests.length||!request.writableFinished)return fail();finish();});
   res.on('close',()=>{if(!res.complete)fail();});
  });
  request.on('error',fail);timer=setTimeout(()=>finish(Error('appserver_canary_timeout')),Math.min(25000,timeoutMs));
  request.flushHeaders();send(requests[0]);
 });
}
