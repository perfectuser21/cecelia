'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHmac}=require('node:crypto');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const nonce='d'.repeat(64),id='a'.repeat(64),imageId='sha256:'+'b'.repeat(64),hostBoot='1347658b-2aa4-4b38-91c0-a7b85531b918',workerBoot='2347658b-2aa4-4b38-91c0-a7b85531b918';
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'linux-pool-canary-'))),calls=[];
 const input={schema_version:1,machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',machine_id:'vps-hk',role:'worker',endpoint_host:'100.64.0.3',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:0.5,memory_bytes:536870912,pids_limit:128},canary_image:'test/image@sha256:'+'c'.repeat(64)};
 const profile=validateLinuxPoolProfile(input),token='e'.repeat(64),revision='f'.repeat(40);let container=null;
 const deps={lockHeld:true,platform:'linux',getuid:()=>0,stateRoot:root,rootUid:process.getuid(),
  loadConfiguration:async()=>({input,token,revision}),readText:async()=>hostBoot,
  readlink:async p=>p==='/proc/1/exe'?'/usr/lib/systemd/systemd':p.split('/').at(-1)+':[4026531835]',
  fetchFn:async(_url,options)=>{const challenge=JSON.parse(options.body).nonce,receipt={schema_version:'linux-pool-identity/v1',nonce:challenge,machine_registry_id:profile.machine_registry_id,machine_id:profile.machine_id,worker_boot_id:workerBoot,revision,config_digest:profile.config_digest,execution:false,observed_at:new Date().toISOString()};return new Response(JSON.stringify({receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')}));},
  collectProof:async({expected})=>({schema_version:'linux-pool-proof/v1',pool_verified:true,execution:false,machine_registry_id:profile.machine_registry_id,config_digest:profile.config_digest,host_boot_id:hostBoot,daemon_id:'daemon-hk',container_id:expected.container_id,cgroup_parent:profile.cgroup_parent,cpu_cores:0.5,memory_limit_bytes:536870912,pids_limit:128,observed_at:new Date().toISOString()}),
  runCommand:async(command,args)=>{
   calls.push([command,args]);if(command==='/usr/bin/systemd-detect-virt')throw Object.assign(Error(),{code:1,stdout:'none\n'});
   if(command==='/usr/bin/systemctl')return {stdout:''};
   if(args[0]==='info')return {stdout:JSON.stringify({ID:'daemon-hk',CgroupDriver:'systemd',CgroupVersion:'2'})};
   if(args[0]==='image')return {stdout:imageId};
   if(args[0]==='create'){
    const labels={};for(let i=0;i<args.length;i++)if(args[i]==='--label'){const[k,...v]=args[i+1].split('=');labels[k]=v.join('=');}
    container={Id:id,Name:'/'+args[args.indexOf('--name')+1],Image:imageId,Config:{Image:profile.canary_image,User:'65534:65534',Labels:labels},Mounts:[],State:{Running:false,Pid:0},HostConfig:{CgroupParent:profile.cgroup_parent,Privileged:false,ReadonlyRootfs:true,NetworkMode:'none',CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],NanoCpus:250000000,Memory:134217728,MemorySwap:134217728,PidsLimit:32}};return {stdout:id};
   }
   if(args[0]==='inspect'){if(!container||![container.Id,container.Name.slice(1)].includes(args.at(-1)))throw Object.assign(Error(),{code:1,stderr:'Error: No such container: '+args.at(-1)+'\n'});return {stdout:JSON.stringify([container])};}
   if(args[0]==='start'){container.State={Running:true,Pid:2314};return {stdout:id};}
   if(args[0]==='stop'){container.State.Running=false;return {stdout:id};}
   if(args[0]==='rm'){container=null;return {stdout:id};}
   throw Error('unexpected command');
  }};
 const state=()=>JSON.parse(fs.readFileSync(path.join(root,nonce+'.json'),'utf8'));
 return {root,input,profile,token,revision,deps,calls,state,get container(){return container;},set container(v){container=v;},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const run=(f,value=nonce)=>require('./linux-pool-canary.cjs').runLinuxPoolCanary({nonce:value},f.deps);
describe('root同池canary生命周期',()=>{
 it('失败原nonce的cleanup-only回执只报告已确认精确清理，不生成池验收成功',async()=>{const f=fixture();try{
  f.deps.collectProof=async()=>{throw Error('proof failed');};await expect(run(f)).rejects.toThrow();
  const e=await require('./linux-pool-canary.cjs').runLinuxPoolCanary({nonce,cleanupReceipt:true},f.deps);
  expect(e.receipt).toMatchObject({schema_version:'linux-pool-canary-cleanup/v1',execution:false,nonce,container_id:id,cleanup_confirmed:true});
  expect(e.receipt.pool_verified).toBeUndefined();expect(e.signature).toBe(createHmac('sha256',f.token).update(JSON.stringify(e.receipt)).digest('hex'));
  expect(f.calls.filter(([,a])=>a[0]==='create')).toHaveLength(1);
 }finally{f.cleanup();}});
 it('先持久ID再启动，证明+精确清理+absence后才保存绑定身份的HMAC回执',async()=>{const f=fixture();const command=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>{if(c==='/usr/bin/docker'&&a[0]==='start')expect(f.state().container_id).toBe(id);return command(c,a);};
  const result=await run(f);expect(result.receipt).toMatchObject({nonce,execution:false,pool_verified:true,cleanup_confirmed:true,machine_registry_id:f.profile.machine_registry_id,config_digest:f.profile.config_digest,host_boot_id:hostBoot,worker_boot_id:workerBoot,revision:f.revision,container_id:id});
  expect(result.signature).toBe(createHmac('sha256',f.token).update(JSON.stringify(result.receipt)).digest('hex'));expect(f.state().envelope).toEqual(result);expect(fs.statSync(path.join(f.root,nonce+'.json')).mode&0o777).toBe(0o600);expect(JSON.stringify(f.state())).not.toContain(f.token);
  const create=f.calls.find(([,a])=>a[0]==='create')[1];for(const arg of ['--network=none','--read-only','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges','--pull=never'])expect(create).toContain(arg);
  expect(create.some(a=>a.includes('mount')||a.includes('volume'))).toBe(false);expect(f.calls.filter(([,a])=>['start','stop','rm'].includes(a[0])).every(([,a])=>a.at(-1)===id||a.at(-1)==='cecelia-workloads.slice')).toBe(true);
  await run(f);expect(f.calls.filter(([,a])=>a[0]==='create')).toHaveLength(1);
 }finally{f.cleanup();}});
 it.each(['us','zero','not-root','container','bad-signature'])('%s启动前拒绝，无Docker create',async(kind)=>{const f=fixture();try{
  if(kind==='us')f.input.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54';if(kind==='zero')f.input.pool.cpu_cores=0;if(kind==='not-root')f.deps.getuid=()=>501;
  if(kind==='container'){const cmd=f.deps.runCommand;f.deps.runCommand=async(c,a)=>c==='/usr/bin/systemd-detect-virt'?{stdout:'docker'}:cmd(c,a);}
  if(kind==='bad-signature')f.deps.fetchFn=async()=>new Response('{"receipt":{},"signature":"'+ '0'.repeat(64)+'"}');
  await expect(run(f)).rejects.toThrow(/linux_/);expect(f.calls.some(([,a])=>a[0]==='create')).toBe(false);
 }finally{f.cleanup();}});
 it('创建响应未知且未找到对象：同nonce只恢复、不重跑；新nonce不能绕未决',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>{if(a[0]==='create')throw Error('response_lost');return cmd(c,a);};
  await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state().container_id).toBeNull();await expect(run(f)).rejects.toThrow(/linux_/);await expect(run(f,'9'.repeat(64))).rejects.toThrow(/linux_/);
  expect(f.calls.filter(([c,a])=>c==='/usr/bin/docker'&&a[0]==='start')).toHaveLength(0);
 }finally{f.cleanup();}});
 it('创建响应丢失后发现精确labels/image对象，只绑定ID清理，不启动重跑',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>{const r=await cmd(c,a);if(a[0]==='create')throw Error('response_lost');return r;};
  await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state()).toMatchObject({container_id:id,cleanup_confirmed:true});expect(f.container).toBeNull();expect(f.calls.some(([,a])=>a[0]==='start'&&a.at(-1)===id)).toBe(false);expect(f.state().envelope).toBeUndefined();
 }finally{f.cleanup();}});
 it('错标签容器不start/stop/rm，保留完整ID未决',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>{const r=await cmd(c,a);if(a[0]==='create')f.container.Config.Labels['cecelia.pool.nonce']='foreign';return r;};await expect(run(f)).rejects.toThrow(/linux_/);
  expect(f.calls.some(([,a])=>['start','stop','rm'].includes(a[0])&&a.at(-1)===id)).toBe(false);expect(f.state().container_id).toBe(id);expect(f.state().envelope).toBeUndefined();
 }finally{f.cleanup();}});
 it('rm成功但inspect仍存在不能签成功，重建调用仅精确清理旧ID',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>a[0]==='rm'?{stdout:id}:cmd(c,a);await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state().envelope).toBeUndefined();
  f.deps.runCommand=cmd;await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state().cleanup_confirmed).toBe(true);expect(f.calls.filter(([,a])=>a[0]==='create')).toHaveLength(1);
 }finally{f.cleanup();}});
 it('绑定ID缺失不按名称认领替换容器，恢复后没有第二次启动/删除替换者',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
  f.deps.runCommand=async(c,a)=>a[0]==='rm'?{stdout:id}:cmd(c,a);await expect(run(f)).rejects.toThrow(/linux_/);
  f.container.Id='9'.repeat(64);f.deps.runCommand=cmd;const before=f.calls.length;await expect(run(f)).rejects.toThrow(/linux_/);
  expect(f.state().container_id).toBe(id);expect(f.container.Id).toBe('9'.repeat(64));expect(f.calls.slice(before).some(([,a])=>a[0]==='rm'||a.at(-1)===f.container.Name.slice(1))).toBe(false);
 }finally{f.cleanup();}});
 it('proof失败后仍精确清理，无成功回执',async()=>{const f=fixture();try{f.deps.collectProof=async()=>{throw Error('proof_failed');};await expect(run(f)).rejects.toThrow(/linux_/);expect(f.container).toBeNull();expect(f.state().cleanup_confirmed).toBe(true);expect(f.state().envelope).toBeUndefined();}finally{f.cleanup();}});
});
it('真实pending HTTP握手用于生命周期绑定，回执使用服务实际worker boot',async()=>{const f=fixture();const {createLinuxPoolServer}=require('./linux-pool-server.cjs');let server;
 try{server=createLinuxPoolServer({profile:f.input,token:f.token,revision:f.revision,probe:async()=>null});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  f.deps.fetchFn=async(_url,options)=>fetch(`http://127.0.0.1:${server.address().port}/v1/pool/identity`,options);
  const result=await run(f);expect(result.receipt.worker_boot_id).toMatch(/^[a-f0-9-]{36}$/);expect(result.receipt.worker_boot_id).not.toBe(workerBoot);
 }finally{server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));f.cleanup();}
});
it.each(['worker','host','daemon'])('%s身份在proof后变化，清理可保守恢复但没有成功签名',async(kind)=>{const f=fixture();const proof=f.deps.collectProof,fetchFn=f.deps.fetchFn,read=f.deps.readText,cmd=f.deps.runCommand;let changed=false;
 try{f.deps.collectProof=async args=>{const result=await proof(args);changed=true;return result;};
  f.deps.readText=async p=>changed&&kind==='host'?'3347658b-2aa4-4b38-91c0-a7b85531b918':read(p);
  f.deps.runCommand=async(c,a)=>{const result=await cmd(c,a);if(changed&&kind==='daemon'&&a[0]==='info')return {stdout:JSON.stringify({ID:'other-daemon',CgroupDriver:'systemd',CgroupVersion:'2'})};return result;};
  f.deps.fetchFn=async(u,o)=>{const result=await fetchFn(u,o);if(changed&&kind==='worker'){const body=await result.json();body.receipt.worker_boot_id='3347658b-2aa4-4b38-91c0-a7b85531b918';body.signature=createHmac('sha256',f.token).update(JSON.stringify(body.receipt)).digest('hex');return new Response(JSON.stringify(body));}return result;};
  await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state().envelope).toBeUndefined();expect(f.state().container_id).toBe(id);
 }finally{f.cleanup();}
});
it('无Content-Length的身份响应分块超限立即cancel，零create',async()=>{const f=fixture();let cancelled=false;try{
 f.deps.fetchFn=async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}}));
 await expect(run(f)).rejects.toThrow(/linux_/);expect(cancelled).toBe(true);expect(f.calls.some(([,a])=>a[0]==='create')).toBe(false);
}finally{f.cleanup();}});
it('共用安装锁保留他人UUID，仅在已持flock下恢复自身旧canary锁',()=>{const f=fixture();try{
 const {acquireCanaryInstallFence}=require('./linux-pool-canary.cjs'),filename=path.join(f.root,'install.lock');fs.writeFileSync(filename,'installer-owner',{mode:0o600});
 expect(()=>acquireCanaryInstallFence({filename,nonce,uid:process.getuid(),underFlock:true})).toThrow(/linux_/);expect(fs.readFileSync(filename,'utf8')).toBe('installer-owner');
 fs.writeFileSync(filename,JSON.stringify({owner_kind:'linux-pool-canary',nonce:'9'.repeat(64)}));
 expect(()=>acquireCanaryInstallFence({filename,nonce,uid:process.getuid(),underFlock:false})).toThrow(/linux_/);
 const release=acquireCanaryInstallFence({filename,nonce,uid:process.getuid(),underFlock:true});expect(JSON.parse(fs.readFileSync(filename,'utf8')).nonce).toBe(nonce);release();expect(fs.existsSync(filename)).toBe(false);
}finally{f.cleanup();}});
it('完成回执重放仍核安装身份及worker boot，不能跨重启当新证明',async()=>{const f=fixture();try{
 await run(f);const fetchFn=f.deps.fetchFn;f.deps.fetchFn=async(u,o)=>{const body=await(await fetchFn(u,o)).json();body.receipt.worker_boot_id='4347658b-2aa4-4b38-91c0-a7b85531b918';body.signature=createHmac('sha256',f.token).update(JSON.stringify(body.receipt)).digest('hex');return new Response(JSON.stringify(body));};
 await expect(run(f)).rejects.toThrow(/linux_/);expect(f.calls.filter(([,a])=>a[0]==='create')).toHaveLength(1);
}finally{f.cleanup();}});
it('完成回执不跨daemon替换重放，不能借同一worker boot认可旧池',async()=>{const f=fixture();try{
 await run(f);const cmd=f.deps.runCommand;f.deps.runCommand=async(c,a)=>a[0]==='info'?{stdout:JSON.stringify({ID:'replacement-daemon',CgroupDriver:'systemd',CgroupVersion:'2'})}:cmd(c,a);
 await expect(run(f)).rejects.toThrow(/linux_/);
}finally{f.cleanup();}});
it('尚未调用Docker create的slice启动失败可确证无容器，不永久阻塞下一nonce',async()=>{const f=fixture();const cmd=f.deps.runCommand;try{
 f.deps.runCommand=async(c,a)=>{if(c==='/usr/bin/systemctl'&&a[0]==='start')throw Error('slice_failed');return cmd(c,a);};
 await expect(run(f)).rejects.toThrow(/linux_/);expect(f.state()).toMatchObject({container_id:null,cleanup_confirmed:true});expect(f.calls.some(([,a])=>a[0]==='create')).toBe(false);
 f.deps.runCommand=cmd;expect((await run(f,'8'.repeat(64))).receipt.cleanup_confirmed).toBe(true);
}finally{f.cleanup();}});
it('PID1非systemd时在创建任何journal目录前拒绝',async()=>{const f=fixture();try{
 f.deps.stateRoot=path.join(f.root,'not-created');f.deps.readlink=async()=>'/usr/bin/node';await expect(run(f)).rejects.toThrow(/linux_/);expect(fs.existsSync(f.deps.stateRoot)).toBe(false);
}finally{f.cleanup();}});

it('缺失容器错误必须字面精确绑定引用，不能把正则元字符解释成匹配权限',()=>{
 const {isMissingContainerError}=require('./linux-pool-canary.cjs');
 expect(isMissingContainerError).toBeTypeOf('function');
 for(const prefix of ['Error: No such container: ','Error response from daemon: No such object: ']){
  expect(isMissingContainerError({code:1,stderr:prefix+'task.a'},'task.a')).toBe(true);
  expect(isMissingContainerError({code:1,stderr:prefix+'taskXa'},'task.a')).toBe(false);
  expect(isMissingContainerError({code:1,stderr:prefix+'other'},'.*')).toBe(false);
  expect(isMissingContainerError({code:2,stderr:prefix+'task.a'},'task.a')).toBe(false);
 }
});
