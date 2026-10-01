'use strict';
const {createHmac}=require('node:crypto');
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
