import {it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {markerFixture} from './fixtures.js';
const require=createRequire(import.meta.url),source=fileURLToPath(new URL('.',import.meta.url));
async function configuredFixture(run){
 const {SOURCE_FILES,buildManifest}=require('./configuration.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phone-hub-runtime-'));
 const installed=path.join(root,'phone-hub');fs.mkdirSync(installed);
 const token='fixture-private-token-'.repeat(3),digest='a'.repeat(64);
 try{
  for(const name of SOURCE_FILES){const p=path.join(installed,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(source,name),p);fs.chmodSync(p,0o600);}
  const targets=[{machine_id:'fixture-target',worker_id:'fixture-worker',physical_boot_id:'fixture-observed-boot',config_digest:digest,build_digest:digest,action_digest:digest,ssh:{host:'fixture-host',user:'administrator',port:22}}];
  const manifest=buildManifest(installed,{hub_id:'fixture-hub',http_endpoint:'http://fixture-hub:3459',targets});
  const configPath=path.join(root,'config.json'),tokenPath=path.join(root,'token'),journal=path.join(root,'journal'),marker=path.join(root,'drain');
  fs.writeFileSync(configPath,JSON.stringify(manifest),{mode:0o600});fs.writeFileSync(tokenPath,token,{mode:0o600});fs.writeFileSync(marker,'drain');
  const pySource=path.join(source,'../phone-ssh');execFileSync('python3',['-B','-c','from journal import Journal;import sys;Journal(sys.argv[1])',journal],{env:{...process.env,PYTHONPATH:pySource}});
  const control=async request=>JSON.parse(execFileSync('python3',['-B','-c','import sys,json;sys.path.insert(0,sys.argv[1]);from control import handle;print(json.dumps(handle(json.loads(sys.argv[2]),sys.argv[3],sys.argv[4])))',source,JSON.stringify(request),journal,marker],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  await run({root,manifest,installed,configPath,tokenPath,token,control,targets,journal});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
it('固定生产manifest按实际依赖bytes校验；变更hash/未知配置/不安全token均默认503',async()=>{
 const {createRuntime}=require('./runtime.cjs');
 await configuredFixture(async f=>{
  for(const mode of ['missing','tampered','token-mode']){
   fs.copyFileSync(path.join(source,'service.cjs'),path.join(f.installed,'service.cjs'));fs.chmodSync(f.tokenPath,0o600);
   if(mode==='tampered')fs.appendFileSync(path.join(f.installed,'service.cjs'),'\nchanged');
   if(mode==='token-mode')fs.chmodSync(f.tokenPath,0o644);
   const runtime=await createRuntime({configPath:mode==='missing'?path.join(f.root,'missing'):f.configPath,tokenPath:f.tokenPath,sourceRoot:f.installed,runControl:f.control});expect(runtime.configured).toBe(false);
  }
 });
});
it('真实本地控制journal追踪nativeowner；配置target未探明不能用本地空账签端到端静默',async()=>{
 const {createRuntime}=require('./runtime.cjs');
 await configuredFixture(async f=>{
  let entered,release;const started=new Promise(r=>entered=r),held=new Promise(r=>release=r);
  const runtime=await createRuntime({configPath:f.configPath,tokenPath:f.tokenPath,sourceRoot:f.installed,runControl:f.control,runProbe:async()=>{entered();await held;throw Error('physical fixture unconfirmed');}});
  expect(runtime.configured).toBe(true);expect(runtime.identity.boot_id).toBeTruthy();expect(runtime.identity).not.toHaveProperty('available');
  const pending=runtime.capabilities('fixture-target');await started;
  expect(await f.control({operation:'snapshot'})).toMatchObject({in_flight:1});
  release();await expect(pending).rejects.toThrow('phone_capabilities_unconfirmed');
  expect(await f.control({operation:'snapshot'})).toMatchObject({in_flight:0});
  const result=await runtime.maintenance();expect(result.quiescent).toBe(false);expect(result.targets).toEqual([{machine_id:'fixture-target',status:'unknown'}]);
 });
});
it('公开control请求无法配置journal/marker/owner/路径，失主activity不自动消除',async()=>{
 await configuredFixture(async f=>{
  for(const extra of [{journal_root:'/bad'},{owner:{pid:123}},{marker:'/bad'}])await expect(f.control({operation:'snapshot',...extra})).rejects.toThrow();
  const value=await f.control({operation:'begin'});expect(value.token).toMatch(/^[a-f0-9-]{36}$/);
  expect(await f.control({operation:'snapshot'})).toMatchObject({in_flight:1});
  await f.control({operation:'end',token:value.token});
  await expect(f.control({operation:'end',token:randomUUID()})).rejects.toThrow();
 });
});
it('维护自身只读探测不伪造外部活动竞态',async()=>{
 const {createRuntime}=require('./runtime.cjs');
 await configuredFixture(async f=>{
  const runProbe=async(_file,_args,input)=>{
   const t=f.targets[0];return {code:0,stdout:JSON.stringify({schema:'phone-physical-probe/v1',request_nonce:JSON.parse(input).request_nonce,
    machine_id:t.machine_id,worker_id:t.worker_id,physical_boot_id:t.physical_boot_id,config_digest:t.config_digest,build_digest:t.build_digest,action_digest:t.action_digest,action:'adb_get_state',
    resources:{cpu_count:4,memory_total_bytes:8000000000,memory_free_bytes:1000000000,load_1m:0.2,data_free_bytes:1000000000},adb_daemon:{reachable:true},external_locks:{occupied:0},
    maintenance:{draining:true,stable:true,quiescent:true,pending:0,in_flight:0,activity_revision:2,marker_identity:markerFixture},observed_at:new Date().toISOString()})};
  };
  const runtime=await createRuntime({configPath:f.configPath,tokenPath:f.tokenPath,sourceRoot:f.installed,runControl:f.control,runProbe});
  expect((await runtime.maintenance()).quiescent).toBe(true);
 });
});
it('已启动不可变版本的实际文件改变后不继续签发旧hash',async()=>{
 const {createRuntime}=require('./runtime.cjs');await configuredFixture(async f=>{
  const runtime=await createRuntime({configPath:f.configPath,tokenPath:f.tokenPath,sourceRoot:f.installed,runControl:f.control,runProbe:async()=>{throw Error('must not execute');}});
  fs.appendFileSync(path.join(f.installed,'control.py'),'\nchanged');
  await expect(runtime.capabilities('fixture-target')).rejects.toThrow('phone_hub_version_changed');
  await expect(runtime.maintenance()).rejects.toThrow('phone_hub_version_changed');
 });
});

it('生产Hub入口只绑定manifest声明的实际本机Tailscale IPv4，不占loopback/wildcard',async()=>{
 const {startRuntimeListener}=require('./runtime.cjs');
 const interfaces=vi.spyOn(os,'networkInterfaces').mockReturnValue({utun9:[{address:'100.100.100.100',family:'IPv4',internal:false}],lo0:[{address:'127.0.0.1',family:'IPv4',internal:true}]});
 try{
  const server={listen:vi.fn((_port,_host,ready)=>ready()),once:vi.fn(),removeListener:vi.fn()};
  await startRuntimeListener({configured:true,identity:{http_endpoint:'http://100.100.100.100:3459/'},server});
  expect(server.listen).toHaveBeenCalledWith(3459,'100.100.100.100',expect.any(Function));
 }finally{interfaces.mockRestore();}
});
it('缺失可信配置、非本机、DNS、公网、loopback或wildcard都拒绝启动监听',async()=>{
 const {startRuntimeListener}=require('./runtime.cjs');
 const interfaces=vi.spyOn(os,'networkInterfaces').mockReturnValue({utun9:[{address:'100.100.100.100',family:'IPv4',internal:false}]});
 try{
  for(const endpoint of ['http://100.100.100.101:3459/','http://fixture-hub:3459/','http://8.8.8.8:3459/','http://127.0.0.1:3459/','http://0.0.0.0:3459/','http://100.63.255.255:3459/','http://100.128.0.1:3459/','http://100.100.100.100:3457/','http://100.100.100.100:3459/path','http://[::]:3459/']){
   const server={listen:vi.fn()};await expect(startRuntimeListener({configured:true,identity:{http_endpoint:endpoint},server})).rejects.toThrow('phone_hub_listener_untrusted');expect(server.listen).not.toHaveBeenCalled();
  }
  const server={listen:vi.fn()};await expect(startRuntimeListener({configured:false,server})).rejects.toThrow('phone_hub_listener_untrusted');expect(server.listen).not.toHaveBeenCalled();
 }finally{interfaces.mockRestore();}
});
it('本机Tailscale端口被占用时保留bind失败，不能fallback或改占loopback',async()=>{
 const {startRuntimeListener}=require('./runtime.cjs');
 const interfaces=vi.spyOn(os,'networkInterfaces').mockReturnValue({utun9:[{address:'100.100.100.100',family:'IPv4',internal:false}]});
 try{
  let failed;const failure=Object.assign(Error('occupied'),{code:'EADDRINUSE'});
  const server={once:vi.fn((_event,handler)=>{failed=handler;}),removeListener:vi.fn(),listen:vi.fn(()=>failed(failure))};
  await expect(startRuntimeListener({configured:true,identity:{http_endpoint:'http://100.100.100.100:3459/'},server})).rejects.toBe(failure);
  expect(server.listen).toHaveBeenCalledTimes(1);
 }finally{interfaces.mockRestore();}
});
