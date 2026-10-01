const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');
const {createLinuxScriptRuntime}=require('./linux-script-runtime.cjs');
const {signLinuxScriptPermit}=require('./linux-script-permit.cjs');
const {fixture}=require('./linux-script-test-fixture.cjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const roots=[],runners=[];afterEach(()=>{for(const r of runners.splice(0))r.close();for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
function setup() {
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'linux-script-runtime-'));roots.push(root);
 const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
 const key='9'.repeat(64),profile=f.record.profile,i=f.record.identity;
 const expected={machine_registry_id:f.record.pool.machine_registry_id,pool_config_digest:validateLinuxPoolProfile(f.record.pool).config_digest,revision:'c'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:i.worker_boot_id,daemon_id:f.record.daemon_id,execution_version_id:i.execution_version_id,execution_grant_id:i.execution_grant_id,profile_digest:hash(profile)};
 const deployment={pool:f.record.pool,revision:expected.revision,host_boot_id:expected.host_boot_id,worker_boot_id:expected.worker_boot_id,daemon_id:expected.daemon_id,execution_enabled:true,profiles:{safe:{profile,image_id:f.record.image_id,execution_version_id:i.execution_version_id,execution_grant_id:i.execution_grant_id}}};
 const options={stateRoot:root,ownerUid:process.getuid(),pathRoot:root,platform:'linux',getuid:()=>0,key,deployment,assertCanLaunch:async()=>{},run:f.options.run};
 const runtime=createLinuxScriptRuntime(options);runners.push(runtime);
 const body={...i,job:{profile:'safe',cmd:f.input.command,timeout_sec:30,env:f.input.env}};
 const request=(action,value=body)=>{const b={...value,request_nonce:randomUUID()};return {...b,permit:signLinuxScriptPermit({key,expected,action,body:b})};};
 return {f,root,key,expected,options,runtime,body,request};
}
describe('root journal实际复用script-runner生命周期',()=>{
 it('启动请求尚未到达时可先持久墓碑确认缺失，迟到的同代启动不能复活',async()=>{
  const x=setup(),body={...x.body,container_id:null,challenge:randomUUID()};delete body.job;
  expect(await x.runtime.cancel(x.request('cancel',body))).toMatchObject({absent:true,tombstoned:true});
  await expect(x.runtime.start(x.request('start'))).rejects.toThrow('script_launch_tombstoned');
  expect(x.f.calls.some(a=>['create','start','rm'].includes(a[0]))).toBe(false);
 });
 it('真实持久runtime→实际script-runner→受限adapter，重建后不重跑，旧grant撤销仍可精确清理',async()=>{
  const x=setup(),started=await x.runtime.start(x.request('start'));expect(started.container_id).toBe('a'.repeat(64));
  const disk=JSON.parse(fs.readFileSync(path.join(x.root,x.body.reservation_id+'.runtime.json'),'utf8'));
  expect(disk.phase).toBe('bound');expect(disk.profile).toEqual(x.f.record.profile);expect(disk.identity.execution_grant_id).toBe(x.body.execution_grant_id);
  const text=JSON.stringify(disk);expect(text).not.toContain(x.key);expect(text).not.toContain(x.body.job.cmd);expect(disk.job).toBeUndefined();
  x.runtime.close();const restored=createLinuxScriptRuntime({...x.options,deployment:{...x.options.deployment,execution_enabled:false,profiles:{}}});runners.push(restored);
  expect((await restored.inspect(x.request('inspect',x.body))).container_id).toBe(started.container_id);
  const clean=await restored.cancel(x.request('cancel',{...x.body,challenge:randomUUID(),container_id:started.container_id}));expect(clean).toMatchObject({absent:true,tombstoned:true});
  expect(x.f.calls.filter(a=>a[0]==='create').length).toBe(1);expect(x.f.calls.filter(a=>a[0]==='rm')).toEqual([['rm','--force',started.container_id]]);
 });
 it('缺permit/未知profile/禁执行部署均零create',async()=>{
  const x=setup();await expect(x.runtime.start(x.body)).rejects.toThrow();
  await expect(x.runtime.start(x.request('start',{...x.body,job:{...x.body.job,profile:'other'}}))).rejects.toThrow();
  const disabled=createLinuxScriptRuntime({...x.options,deployment:{...x.options.deployment,execution_enabled:false}});runners.push(disabled);
  await expect(disabled.start(x.request('start'))).rejects.toThrow();expect(x.f.calls.length).toBe(0);
 });
 it('create响应未知跨重启保持精确占位，不重跑不误清理',async()=>{
  const x=setup();x.f.createFailure=true;await expect(x.runtime.start(x.request('start'))).rejects.toThrow();x.runtime.close();
  const restored=createLinuxScriptRuntime(x.options);runners.push(restored);
  await expect(restored.start(x.request('start'))).rejects.toThrow();
  await expect(restored.cancel(x.request('cancel',{...x.body,challenge:randomUUID(),container_id:null}))).rejects.toThrow();
  expect(x.f.calls.filter(a=>a[0]==='create').length).toBe(1);expect(x.f.calls.some(a=>a[0]==='rm')).toBe(false);
 });
 it('同预约并发不跨越持久锁，锁竞争不覆盖记录',async()=>{
  const x=setup();let release;const held=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
  const runtime=createLinuxScriptRuntime({...x.options,assertCanLaunch:async()=>{entered();await held;}});runners.push(runtime);
  const first=runtime.start(x.request('start'));await ready;
  await expect(x.runtime.start(x.request('start'))).rejects.toThrow('linux_script_operation_locked');release();await first;
  expect(x.f.calls.filter(a=>a[0]==='create').length).toBe(1);
 });
 it('create响应未知且daemon尚未出现容器时，不能以一次名称缺失释放预约',async()=>{
  const x=setup();x.f.createFailure=true;await expect(x.runtime.start(x.request('start'))).rejects.toThrow();
  x.f.container=null;x.runtime.close();const restored=createLinuxScriptRuntime(x.options);runners.push(restored);
  await expect(restored.cancel(x.request('cancel',{...x.body,challenge:randomUUID(),container_id:null}))).rejects.toThrow('linux_script_create_unconfirmed');
  expect(x.f.calls.some(a=>a[0]==='rm')).toBe(false);
 });
 it('旧waiting_resources不能因重启复用旧boot启动，新许可未确认不执行',async()=>{
  const x=setup();x.options.assertCanLaunch=async()=>{throw Error('script_local_resources_unavailable');};
  const busy=createLinuxScriptRuntime(x.options);runners.push(busy);expect((await busy.start(x.request('start'))).status).toBe('waiting_resources');busy.close();
  const restored=createLinuxScriptRuntime({...x.options,assertCanLaunch:async()=>{},deployment:{...x.options.deployment,worker_boot_id:randomUUID()}});runners.push(restored);
  await expect(restored.start(x.request('start'))).rejects.toThrow('linux_script_deployment_changed');expect(x.f.calls.some(a=>a[0]==='create')).toBe(false);
 });
 it.each([0,1300])('start实际生效但%s毫秒后丢回执，当前进程仍精确超时清理',async delay=>{
  const x=setup();x.runtime.close();x.body.job.timeout_sec=1;
  x.body.config_digest=hash({job:x.body.job,profile_digest:x.expected.profile_digest});
  x.f.record.identity.config_digest=x.body.config_digest;
  const run=x.options.run;
  const runtime=createLinuxScriptRuntime({...x.options,run:async(...args)=>{
   const result=await run(...args);
   if(args[1][0]==='start'){if(delay)await new Promise(r=>setTimeout(r,delay));throw Error('lost start response');}
   return result;
  }});runners.push(runtime);
  await expect(runtime.start(x.request('start'))).rejects.toThrow('linux_script_operation_unconfirmed');
  await new Promise(r=>setTimeout(r,delay?350:1300));
  expect(x.f.calls.filter(a=>a[0]==='rm')).toEqual([['rm','--force','a'.repeat(64)]]);
  const observed=await runtime.inspect(x.request('inspect'));expect(observed).toMatchObject({status:'cleaned',terminal:{exit_code:124,timed_out:true}});
 });
});
