import {it,expect} from 'vitest';
import {createHmac,randomUUID} from 'node:crypto';
import {createAppServerClient} from '../client.js';
import {workerIdentity} from '../identity.js';
function capabilityReply(row,body,token){const receipt={machine_id:row.machine_id,worker_id:row.worker_id,worker_boot_id:row.worker_boot_id,profiles:{[row.config.profile]:row.config_digest},request_nonce:body.request_nonce};return new Response(JSON.stringify({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')}));}

it('Worker响应缺签名、重放nonce或HOME/boot不同均不得形成认证封套',async()=>{
 const token='a'.repeat(32),row={id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'worker',worker_boot_id:randomUUID(),owner_key:'openclaw-'+ 'c'.repeat(64),home_key:'d'.repeat(64),config_digest:'e'.repeat(64),config:{profile:'chat'}};
 const store={withOperation:async(_id,_action,fn)=>fn(row,'http://m1:5231',async()=>{})};
 for(const mutation of ['signature','nonce','home','boot']){
  const client=createAppServerClient({pool:{},store,env:{KERNEL_FLEET_BRIDGE_TOKEN:token},fetchFn:async(_url,options)=>{
   const body=JSON.parse(options.body);if(_url.endsWith('/capabilities'))return capabilityReply(row,body,token);const receipt={...workerIdentity(row),status:'running',request_nonce:body.request_nonce};
   if(mutation==='nonce')receipt.request_nonce=randomUUID();if(mutation==='home')receipt.home_key='f'.repeat(64);if(mutation==='boot')receipt.worker_boot_id=randomUUID();
   return new Response(JSON.stringify({receipt,signature:mutation==='signature'?'0'.repeat(64):createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')}));
  }});
  await expect(client.start(row.id)).rejects.toThrow(/^appserver_worker_(receipt_unverified|identity_mismatch)$/);
 }
});
it.each([200,500])('没有Content-Length的分块响应超限立即cancel/abort（HTTP %s）',async status=>{
 let cancelled=false,signal,pulls=0;
 const store={withOperation:async(_id,_action,fn)=>fn({id:randomUUID(),config:{profile:'chat'},machine_id:'xian-mac-m1'},'http://m1:5231')};
 const client=createAppServerClient({pool:{},store,env:{KERNEL_FLEET_BRIDGE_TOKEN:'x'.repeat(32)},fetchFn:async(_url,options)=>{
  signal=options.signal;return new Response(new ReadableStream({pull(controller){pulls++;if(pulls<=8)controller.enqueue(new Uint8Array(65536));else controller.close();},cancel(){cancelled=true;}}),{status});
 }});
 await expect(client.start(randomUUID())).rejects.toThrow('appserver_worker_response_oversized');
 expect(cancelled).toBe(true);expect(signal.aborted).toBe(true);expect(pulls).toBeLessThanOrEqual(4);
});
it('分块读取也受deadline限制；断链不泄漏远端错误正文',async()=>{
 for(const mode of ['timeout','disconnect']){
  let cancelled=false,signal;
  const store={withOperation:async(_id,_action,fn)=>fn({id:randomUUID(),config:{profile:'chat'},machine_id:'xian-mac-m1'},'http://m1:5231')};
  const client=createAppServerClient({pool:{},store,timeoutMs:15,env:{KERNEL_FLEET_BRIDGE_TOKEN:'x'.repeat(32)},fetchFn:async(_url,options)=>{
   signal=options.signal;return new Response(new ReadableStream({start(controller){if(mode==='disconnect')controller.error(Error('remote-secret-text'));},cancel(){cancelled=true;}}));
  }});
  await expect(client.start(randomUUID())).rejects.toThrow(mode==='timeout'?'appserver_worker_response_timeout':'appserver_worker_response_unavailable');
  expect(signal.aborted).toBe(true);if(mode==='timeout')expect(cancelled).toBe(true);
 }
});
it('真实无长度HTTP流超过上限后对端连接关闭，不等待服务端结束响应',async()=>{
 const {createServer}=await import('node:http');let closed;
 const stopped=new Promise(resolve=>closed=resolve);
 const server=createServer((_req,res)=>{
  res.writeHead(500,{'content-type':'application/json'});
  const timer=setInterval(()=>res.write(Buffer.alloc(65536)),5);
  res.once('close',()=>{clearInterval(timer);closed();});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const store={withOperation:async(_id,_action,fn)=>fn({id:randomUUID(),config:{profile:'chat'},machine_id:'xian-mac-m1'},`http://127.0.0.1:${server.address().port}`)};
 try{
  const client=createAppServerClient({pool:{},store,timeoutMs:1000,env:{KERNEL_FLEET_BRIDGE_TOKEN:'x'.repeat(32)}});
  await expect(client.start(randomUUID())).rejects.toThrow('appserver_worker_response_oversized');
  await stopped;
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('流许可只暴露签名绑定的header票；prepare使用持久流ID和最终目录operation',async()=>{
 const token='a'.repeat(32),ticket='b'.repeat(64),id=randomUUID(),streamId=randomUUID();
 const row={id,intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'worker',worker_boot_id:randomUUID(),owner_key:'openclaw-'+ 'c'.repeat(64),home_key:'d'.repeat(64),config_digest:'e'.repeat(64),config:{profile:'chat'},stream:{id:streamId,prepare_deadline:new Date(Date.now()+5000)}};
 const store={reserveStream:async()=>row.stream,withOperation:async(_id,action,fn)=>{expect(action).toBe('prepare-stream');return fn(row,'http://m1:5231',async()=>{});}};
 const {createHash}=await import('node:crypto');
 const client=createAppServerClient({pool:{},store,env:{KERNEL_FLEET_BRIDGE_TOKEN:token},fetchFn:async(url,options)=>{
  const body=JSON.parse(options.body);if(url.endsWith('/capabilities'))return capabilityReply(row,body,token);expect(url).toBe(`http://m1:5231/app-servers/${id}/prepare-stream`);expect(body.stream_id).toBe(streamId);
  const receipt={...workerIdentity(row),stream_id:streamId,expires_at:Date.now()+3000,request_nonce:body.request_nonce,token_digest:createHash('sha256').update(ticket).digest('hex')};
  return new Response(JSON.stringify({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')}),{headers:{'x-appserver-stream-token':ticket}});
 }});
 expect(client.prepareStream).toBeTypeOf('function');expect(await client.prepareStream(id)).toMatchObject({token:ticket,stream_id:streamId,stream_url:`http://m1:5231/app-server-streams/${streamId}`});
});

it('验收start携带完整身份签名短期许可，保留Worker原始回执签名',async()=>{
 const token='a'.repeat(32),row={id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'worker',worker_boot_id:randomUUID(),owner_key:'openclaw-'+ 'c'.repeat(64),home_key:'d'.repeat(64),config_digest:'e'.repeat(64),config:{profile:'chat'},canary_authorization:{id:randomUUID(),nonce:randomUUID(),challenge_expires_at:new Date(Date.now()+60000)}};
 const {createRequire}=await import('node:module');const {verifyCanaryPermit}=createRequire(import.meta.url)('../../../scripts/fleet-worker/app-server-canary-permit.cjs');
 let sent,signature;
 const client=createAppServerClient({pool:{},store:{withOperation:async(_id,_action,fn)=>fn(row,'http://m1:5231',async()=>{})},env:{KERNEL_FLEET_BRIDGE_TOKEN:token},fetchFn:async(_url,options)=>{
  sent=JSON.parse(options.body);if(_url.endsWith('/capabilities'))return capabilityReply(row,sent,token);const receipt={...workerIdentity(row),status:'running',request_nonce:sent.request_nonce};signature=createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex');return new Response(JSON.stringify({receipt,signature}));
 }});
 const result=await client.start(row.id);
 expect(()=>verifyCanaryPermit(sent.canary_permit,workerIdentity(row),token)).not.toThrow();
 expect(sent.canary_permit.payload.authorization_id).toBe(row.canary_authorization.id);expect(result.signature).toBe(signature);
});
