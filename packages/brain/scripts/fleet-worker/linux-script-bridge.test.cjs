const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {createHmac,randomUUID}=require('node:crypto');
const {createLinuxScriptBridge,createLinuxScriptBridgeClient}=require('./linux-script-bridge.cjs');
const roots=[],servers=[];
afterEach(async()=>{for(const s of servers.splice(0))await new Promise(r=>s.close(r));for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
async function setup(options={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lsb-'));roots.push(root);const socketPath=path.join(root,'s');
 const key='a'.repeat(64),calls=[];
 const runtime={start:async b=>{calls.push(['start',b]);return {...b,permit:undefined,status:'running'};},inspect:async b=>{calls.push(['inspect',b]);return {status:'exited'};},cancel:async b=>{calls.push(['cancel',b]);return {status:'cleaned',absent:true};}};
 const server=createLinuxScriptBridge({key,runtime,...options});servers.push(server);await new Promise(r=>server.listen(socketPath,r));
 const client=createLinuxScriptBridgeClient({socketPath,timeoutMs:1000});
 return {client,server,socketPath,calls,key};
}
function raw(socketPath,route,body,method='POST') {return new Promise((resolve,reject)=>{const q=http.request({socketPath,path:route,method},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(text)}));});q.on('error',reject);q.end(body);});}
describe('root窄Unix执行桥',()=>{
 it('真实Unix传输只转发三个动作，root回执签名绑定nonce且不暴露许可',async()=>{
  const x=await setup(),body={reservation_id:randomUUID(),request_nonce:randomUUID(),permit:{signature:'secret'}};
  const reply=await x.client.start(body);
  expect(reply.status).toBe(200);expect(x.calls).toEqual([['start',body]]);
  expect(reply.envelope.receipt.request_nonce).toBe(body.request_nonce);
  expect(reply.envelope.signature).toBe(createHmac('sha256',x.key).update(JSON.stringify(reply.envelope.receipt)).digest('hex'));
  expect(JSON.stringify(reply.envelope)).not.toContain('secret');
  await x.client.inspect(body);await x.client.cancel(body);expect(x.calls.map(c=>c[0])).toEqual(['start','inspect','cancel']);
 });
 it.each(['/exec','/start?command=evil','/capabilities','/'])('未知%s路由零runtime调用',async route=>{
  const x=await setup();expect((await raw(x.socketPath,route,'{}')).status).toBe(404);expect(x.calls).toEqual([]);
 });
 it('限制方法、正文长度与nonce，错误不返回底层凭据',async()=>{
  const x=await setup({runtime:{start:async()=>{throw Error('secret-key-value');}}});
  expect((await raw(x.socketPath,'/start','{}','GET')).status).toBe(405);
  expect((await raw(x.socketPath,'/start',JSON.stringify({request_nonce:randomUUID(),padding:'x'.repeat(66000)}))).status).toBe(413);
  expect((await raw(x.socketPath,'/start','{}')).status).toBe(400);
  const result=await raw(x.socketPath,'/start',JSON.stringify({request_nonce:randomUUID()}));expect(result.status).toBe(409);expect(JSON.stringify(result)).not.toContain('secret');
 });
 it('waiting_resources仍由root签名回429；客户端遇超大回包及错误状态拒绝',async()=>{
  const x=await setup({runtime:{start:async()=>({status:'waiting_resources'})}});
  expect((await x.client.start({request_nonce:randomUUID()})).status).toBe(429);
  x.server.removeAllListeners('request');x.server.on('request',(_q,r)=>{r.writeHead(200);r.end('x'.repeat(140000));});
  await expect(x.client.inspect({request_nonce:randomUUID()})).rejects.toThrow('linux_script_bridge_response_oversized');
 });
 it('客户端deadline覆盖读取正文，不能被持续小块续命',async()=>{
  const x=await setup();x.server.removeAllListeners('request');x.server.on('request',(_q,r)=>{r.writeHead(200);r.write('{');});
  const client=createLinuxScriptBridgeClient({socketPath:x.socketPath,timeoutMs:80});
  await expect(client.inspect({request_nonce:randomUUID()})).rejects.toThrow('linux_script_bridge_unavailable');
 });
});
