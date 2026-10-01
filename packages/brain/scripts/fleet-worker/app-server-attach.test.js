import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
const require=createRequire(import.meta.url);
const {createAppServerDocker}=require('./app-server-docker.cjs');
const id='a'.repeat(64);
async function fixture(handler){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'docker-attach-')),socketPath=path.join(root,'engine.sock');
 const server=http.createServer();const sockets=new Set();server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});server.on('upgrade',(req,socket,head)=>{socket.resume();socket.on('end',()=>socket.end());handler(req,socket,head);});
 await new Promise(r=>server.listen(socketPath,r));
 const docker=createAppServerDocker({env:{DOCKER_HOST:`unix://${socketPath}`}});
 return {docker,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}};
}
function frame(type,text){const b=Buffer.from(text),h=Buffer.alloc(8);h[0]=type;h.writeUInt32BE(b.length,4);return Buffer.concat([h,b]);}
it('真实Unix HTTP升级前不能返回连接，升级后仅stdout解帧、stdin原样且kill不发送容器信号',async()=>{
 let upgrade,wire,request;const f=await fixture((req,socket)=>{request=req;wire=socket;upgrade=()=>socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/vnd.docker.multiplexed-stream\r\n\r\n');});
 let stream;try{
  let ready=false;const pending=f.docker.attach(id,{deadline:Date.now()+2000}).then(value=>{ready=true;return value;});
  for(let i=0;i<100&&!upgrade;i++)await new Promise(r=>setTimeout(r,2));
  expect(upgrade).toBeTypeOf('function');expect(ready).toBe(false);expect(request.url).toContain(`/containers/${id}/attach?`);expect(request.url).toContain('logs=0');
  upgrade();stream=await pending;let output='';stream.stdout.on('data',c=>output+=c.toString());
  const mux=Buffer.concat([frame(2,'secret stderr'),frame(1,'{"id":1}\n')]);wire.write(mux.subarray(0,3));wire.write(mux.subarray(3));
  for(let i=0;i<100&&!output;i++)await new Promise(r=>setTimeout(r,2));expect(output).toBe('{"id":1}\n');
  const received=once(wire,'data');stream.stdin.write('request\n');expect((await received)[0].toString()).toBe('request\n');
  const closed=once(stream,'close');stream.kill();await closed;
 }finally{stream?.kill();await f.close();}
});
it.each(['deadline','reject','wrong-type'])('attach %s 不发可用连接，关闭实际socket',async(mode)=>{
 let wire;const f=await fixture((_req,socket)=>{wire=socket;if(mode==='reject')socket.end('HTTP/1.1 500 Failed\r\nContent-Length: 0\r\n\r\n');if(mode==='wrong-type')socket.write('HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: text/plain\r\n\r\n');});
 try{await expect(f.docker.attach(id,{deadline:Date.now()+100})).rejects.toThrow('appserver_attach_unconfirmed');for(let i=0;i<100&&wire&&!wire.destroyed;i++)await new Promise(r=>setTimeout(r,2));expect(wire?.destroyed).toBe(true);}finally{await f.close();}
});
it('非本机Unix Docker端点不允许建立数据流',async()=>{
 const d=createAppServerDocker({env:{DOCKER_HOST:'tcp://127.0.0.1:2375'}});
 await expect(d.attach(id,{deadline:Date.now()+100})).rejects.toThrow('appserver_attach_endpoint_denied');
});
