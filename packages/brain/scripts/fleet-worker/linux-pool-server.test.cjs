'use strict';
const {createHmac}=require('node:crypto');
const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {createLinuxPoolServer}=require('./linux-pool-server.cjs');
const input={schema_version:1,machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',machine_id:'vps-hk',role:'worker',
  endpoint_host:'100.90.1.2',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:0.5,memory_bytes:536870912,pids_limit:256},
  canary_image:'test/canary@sha256:'+'c'.repeat(64)};
const token='a'.repeat(64),revision='b'.repeat(40),nonce='c'.repeat(64);
async function fixture(probe=async()=>({status:'observed',cpu_cores:4,execution:true,pool_verified:true})) {
  const server=createLinuxPoolServer({profile:input,token,revision,probe});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:'http://127.0.0.1:'+server.address().port,server,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
describe('Linux pending观察服务',()=>{
  it('接root桥时身份随root执行进程boot换代，拒绝无效boot文件',async()=>{
    let boot=randomUUID();const server=createLinuxPoolServer({profile:input,token,revision,readWorkerBootId:()=>boot});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
    const request=()=>fetch(url+'/v1/pool/identity',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({nonce})});
    try{expect((await (await request()).json()).receipt.worker_boot_id).toBe(boot);boot=randomUUID();expect((await (await request()).json()).receipt.worker_boot_id).toBe(boot);boot='invalid';expect((await request()).status).toBe(400);}
    finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});}
  });
  it('显式Unix桥接线只允许认证三动作，转发root签名原文；未配置保持拒绝',async()=>{
    const calls=[],envelope={receipt:{status:'running'},signature:'root-signature'};
    const bridge=Object.fromEntries(['start','inspect','cancel'].map(action=>[action,async body=>{calls.push([action,body]);return {status:200,envelope};}]));
    const server=createLinuxPoolServer({profile:input,token,revision,scriptBridge:bridge});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port,id=randomUUID();
    const body={reservation_id:id,request_nonce:randomUUID(),permit:{signature:'brain-permit'}};
    try {
      expect((await fetch(url+'/scripts/'+id+'/start',{method:'POST',body:JSON.stringify(body)})).status).toBe(401);
      const response=await fetch(url+'/scripts/'+id+'/start',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
      expect(response.status).toBe(200);expect(await response.json()).toEqual(envelope);expect(calls).toEqual([['start',body]]);
      expect((await fetch(url+'/scripts/'+randomUUID()+'/cancel',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)})).status).toBe(400);
      expect((await fetch(url+'/scripts/capabilities',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'})).status).toBe(400);
      expect(calls).toHaveLength(1);
    } finally {await new Promise(r=>{server.close(r);server.closeAllConnections();});}
  });
  it.each(['headers','body'])('持续滴流的%s不能刷新绝对接收期限',async kind=>{
    const server=createLinuxPoolServer({profile:input,token,revision,bodyTimeoutMs:100,headersTimeoutMs:100});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const socket=net.connect(server.address().port,'127.0.0.1');let timer;
    try {
      await new Promise(resolve=>socket.once('connect',resolve));socket.on('error',()=>{});socket.on('data',()=>{});
      const closed=new Promise(resolve=>socket.once('close',()=>resolve(true)));
      socket.write(kind==='body'?`POST /v1/pool/identity HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nTransfer-Encoding: chunked\r\n\r\n`:'GET /health HTTP/1.1\r\nHost: localhost\r\nX-Slow: ');
      timer=setInterval(()=>{if(!socket.destroyed)socket.write(kind==='body'?'1\r\nx\r\n':'x');},20);
      let deadline;const result=await Promise.race([closed,new Promise(resolve=>{deadline=setTimeout(()=>resolve(false),700);})]);
      clearTimeout(deadline);expect(result).toBe(true);
    } finally {clearInterval(timer);socket.destroy();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  });
  it('真实HTTP健康状态不因采样器自报4核或verified而授予执行',async()=>{
    const f=await fixture();
    try{
      const response=await fetch(f.url+'/health'),body=await response.json();
      expect(response.status).toBe(200);expect(body.machine_id).toBe('vps-hk');
      expect(body.execution).toBe(false);expect(body.pool_verified).toBe(false);
      expect(body.resources).toMatchObject({cpu_cores:0,memory_bytes:0,memory_pressure_percent:100});
      expect(body.linux_observation.execution).toBe(false);expect(body.linux_observation.pool_verified).toBe(false);
      expect(await (await fetch(f.url+'/scripts/start',{method:'POST'})).json()).toEqual({error:'linux_execution_not_authorized'});
    }finally{await f.close();}
  });
  it('身份回执须认证，绑定nonce、版本、配置和同一进程boot；重启生成新boot',async()=>{
    const boots=[];
    for(let i=0;i<2;i++){
      const f=await fixture();
      try{
        expect((await fetch(f.url+'/v1/pool/identity',{method:'POST',body:JSON.stringify({nonce})})).status).toBe(401);
        const request=()=>fetch(f.url+'/v1/pool/identity',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({nonce})});
        const a=await (await request()).json(),b=await (await request()).json();
        expect(a.receipt).toMatchObject({nonce,revision,machine_registry_id:input.machine_registry_id,execution:false});
        expect(a.receipt.config_digest).toMatch(/^[a-f0-9]{64}$/);
        expect(a.signature).toBe(createHmac('sha256',token).update(JSON.stringify(a.receipt)).digest('hex'));
        expect(a.receipt.worker_boot_id).toBe(b.receipt.worker_boot_id);boots.push(a.receipt.worker_boot_id);
      }finally{await f.close();}
    }
    expect(boots[0]).not.toBe(boots[1]);
  });
  it('超长或附带任意执行参数的认证请求拒绝，健康并发共享采样',async()=>{
    let reads=0,resolve;const gate=new Promise(r=>{resolve=r;});
    const f=await fixture(async()=>{reads++;await gate;return {};});
    try{
      for(const body of [JSON.stringify({nonce,command:'rm'}),'x'.repeat(2049)]){
        const r=await fetch(f.url+'/v1/pool/identity',{method:'POST',headers:{Authorization:'Bearer '+token},body});
        expect([400,413]).toContain(r.status);
      }
      const first=fetch(f.url+'/health'),second=fetch(f.url+'/health');
      await new Promise(r=>setTimeout(r,20));resolve();await Promise.all([first,second]);
      expect(reads).toBe(1);
    }finally{resolve();await f.close();}
  });
});
