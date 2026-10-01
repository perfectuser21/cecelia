import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);let api;try{api=require('./app-server-shim.cjs');}catch{api={};}
it('shim配置必须受保护，参数只有HOME幂等键，URL内不能携带凭据',()=>{
 expect(api.loadShimConfig).toBeTypeOf('function');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shim-'));const file=path.join(dir,'config.json');
 const value={brainUrl:'http://127.0.0.1:5221',internalToken:'x'.repeat(32),homeId:'chat-test',requestKey:randomUUID()};
 try{fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});expect(api.loadShimConfig(file)).toEqual(value);
 fs.chmodSync(file,0o644);expect(()=>api.loadShimConfig(file)).toThrow('appserver_shim_config_untrusted');fs.chmodSync(file,0o600);
 fs.writeFileSync(file,JSON.stringify({...value,brainUrl:'http://secret@127.0.0.1:5221'}));expect(()=>api.loadShimConfig(file)).toThrow('appserver_shim_config_invalid');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

import http from 'node:http';
import {PassThrough} from 'node:stream';
it('每次shim启动生成独立请求键，同一静态配置不永久命中旧代',async()=>{
 const keys=[];const server=http.createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
  keys.push(JSON.parse(body).request_key);res.end(JSON.stringify({status:'waiting_resources'}));
 });});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config={brainUrl:`http://127.0.0.1:${server.address().port}`,internalToken:'x'.repeat(32),homeId:'chat-test'};
 try{for(let i=0;i<2;i++)await expect(api.runShim(config)).rejects.toThrow('appserver_waiting_resources');
  expect(keys).toHaveLength(2);for(const key of keys)expect(key).toMatch(/^[a-f0-9-]{36}$/);expect(keys[0]).not.toBe(keys[1]);
 }finally{await new Promise(r=>server.close(r));}
});
it.each(['clean-eof','stdio-error'])('真实HTTP请求送出后%s不能成功退出或自动重试',async(mode)=>{
 const reservation=randomUUID(),streamId=randomUUID();let received=0,controls=0;const sockets=new Set();
 const server=http.createServer((req,res)=>{
  if(req.url.endsWith('/generations')){controls++;res.end(JSON.stringify({status:'running',reservation_id:reservation}));return;}
  if(req.url.endsWith('/stream')){controls++;res.setHeader('x-appserver-stream-token','a'.repeat(64));res.end(JSON.stringify({stream_id:streamId,stream_url:`http://127.0.0.1:${server.address().port}/app-server-streams/${streamId}`,expires_at:Date.now()+5000}));return;}
  res.writeHead(200,{'content-type':'application/x-ndjson'});res.flushHeaders();
  req.once('data',()=>{received++;if(mode==='clean-eof')res.end();else input.destroy(Error('secret raw error'));});
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const input=new PassThrough(),output=new PassThrough();
 try{
  const result=api.runShim({brainUrl:`http://127.0.0.1:${server.address().port}`,internalToken:'x'.repeat(32),homeId:'chat-test',requestKey:randomUUID()},input,output);
  input.write(JSON.stringify({id:1,method:'model/list',params:{}})+'\n');
  await expect(result).rejects.toThrow('appserver_stream_recovery_required');
  expect(received).toBe(1);expect(controls).toBe(2);
 }finally{input.destroy();output.destroy();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
});
