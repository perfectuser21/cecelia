'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const SOURCE_FILES=['linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-resource-probe.cjs','linux-cgroup.cjs'];
function fixture(){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'linux-pool-install-'))),calls=[];
 const put=(name,value,mode=0o600)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o755});fs.writeFileSync(target,value,{mode});return target;};
 const profile={schema_version:1,machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',machine_id:'hk-vps',role:'worker',endpoint_host:'100.64.0.3',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:0.5,memory_bytes:536870912,pids_limit:128},canary_image:`test/image@sha256:${'a'.repeat(64)}`};
 put('/staging/profile.json',JSON.stringify(profile));put('/staging/token','b'.repeat(64));put('/staging/node','trusted-node',0o755);
 for(const name of SOURCE_FILES)put('/staging/source/'+name,fs.readFileSync(path.join(__dirname,name)),0o644);
 const options={sourceDir:'/staging/source',profilePath:'/staging/profile.json',tokenPath:'/staging/token',nodePath:'/staging/node',revision:'c'.repeat(40)};
 const deps={root,rootUid:process.getuid(),platform:'linux',getuid:()=>0,readlink:async()=>'/usr/lib/systemd/systemd',runCommand:async(command,args)=>{
  calls.push([command,args]);
  if(command==='/usr/bin/systemd-detect-virt')throw Object.assign(Error(),{code:1,stdout:'none\n'});
  if(command==='/usr/bin/id')return {stdout:String(args[0]==='-u'?process.getuid():process.getgid())};
  if(command==='/usr/bin/getent')return {stdout:`_cecelia:x:${process.getuid()}:${process.getgid()}:service:/var/lib/cecelia:/usr/sbin/nologin\n`};
  if(command==='/staging/node')return {stdout:'v24.1.0\n'};
  if(command==='/usr/bin/docker')return {stdout:JSON.stringify({ID:'daemon-fixed',CgroupDriver:'systemd',CgroupVersion:'2'})};
  if(args[0]==='show')return {stdout:args.at(-1)==='cecelia-workloads.slice'?'inactive\n':'LoadState=not-found\nActiveState=inactive\nUnitFileState=\n'};
  if(args[0]==='is-active')return {stdout:'active\n'};
  return {stdout:''};
 }};
 return {root,calls,put,profile,options,deps,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const install=(x)=>require('./linux-pool-installer.cjs').installLinuxPool(x.options,x.deps);
describe('可信Linux pool安装事务',()=>{
 it('固定slice/非root pending服务与可信配置落盘，完整依赖可加载，身份revision固定',async()=>{const x=fixture();try{
  const result=await install(x);expect(result).toMatchObject({installed:true,execution:false,revision:'c'.repeat(40)});
  const base=path.join(x.root,'usr/local/libexec/cecelia/fleet-worker');
  expect(require(path.join(base,'linux-pool-server.cjs')).createLinuxPoolServer).toBeTypeOf('function');
  expect(fs.readFileSync(path.join(base,'revision'),'utf8').trim()).toBe('c'.repeat(40));
  for(const file of ['fleet-pool.json','fleet-worker.token'])expect(fs.statSync(path.join(x.root,'etc/cecelia',file)).mode&0o777).toBe(0o600);
  const slice=fs.readFileSync(path.join(x.root,'etc/systemd/system/cecelia-workloads.slice'),'utf8');expect(slice).toContain('CPUQuota=50%');expect(slice).toContain('MemorySwapMax=0');expect(slice).toContain('TasksMax=128');
  expect(fs.readFileSync(path.join(x.root,'etc/systemd/system/cecelia-linux-pool.service'),'utf8')).toContain('User=_cecelia');
  expect(x.calls.filter(([c,a])=>c==='/usr/bin/docker').every(([,a])=>a[0]==='info')).toBe(true);
 }finally{x.cleanup();}});
 it.each(['not-root','not-linux','container','daemon','zero','scheduler','us','revision','profile-mode','profile-symlink','token-mode','active-pool'])('%s拒绝且不写安装目标',async(kind)=>{const x=fixture();try{
  if(kind==='not-root')x.deps.getuid=()=>501;if(kind==='not-linux')x.deps.platform='darwin';
  if(kind==='zero')x.profile.pool.cpu_cores=0;if(kind==='scheduler')x.profile.role='scheduler';if(kind==='us')x.profile.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54';x.put('/staging/profile.json',JSON.stringify(x.profile));
  if(kind==='revision')x.options.revision='HEAD';if(kind==='profile-mode')fs.chmodSync(path.join(x.root,'staging/profile.json'),0o644);
  if(kind==='token-mode')fs.chmodSync(path.join(x.root,'staging/token'),0o644);
  if(kind==='profile-symlink'){fs.renameSync(path.join(x.root,'staging/profile.json'),path.join(x.root,'staging/real.json'));fs.symlinkSync('real.json',path.join(x.root,'staging/profile.json'));}
  const run=x.deps.runCommand;x.deps.runCommand=async(c,a)=>{if(kind==='container'&&c==='/usr/bin/systemd-detect-virt')return {stdout:'docker'};if(kind==='daemon'&&c==='/usr/bin/docker')return {stdout:'{"CgroupDriver":"cgroupfs","CgroupVersion":"2"}'};if(kind==='active-pool'&&a.at(-1)==='cecelia-workloads.slice')return {stdout:'active'};return run(c,a);};
  await expect(install(x)).rejects.toThrow(/linux_/);expect(fs.existsSync(path.join(x.root,'etc'))).toBe(false);
 }finally{x.cleanup();}});
 it.each(['publish','start'])('%s失败恢复旧配置、模块、units字节权限及服务状态',async(failure)=>{const x=fixture();try{
  const files={'/etc/cecelia/fleet-pool.json':['old-profile',0o600],'/etc/cecelia/fleet-worker.token':['old-token',0o600],'/etc/systemd/system/cecelia-linux-pool.service':['old-service',0o644],'/etc/systemd/system/cecelia-workloads.slice':['old-slice',0o644],'/usr/local/libexec/cecelia/fleet-worker/linux-pool-server.cjs':['old-server',0o644]};for(const [file,[value,mode]]of Object.entries(files))x.put(file,value,mode);
  let failed=false;const run=x.deps.runCommand;x.deps.runCommand=async(c,a)=>{if(a[0]==='show'&&a.at(-1)==='cecelia-linux-pool.service')return {stdout:'LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n'};if(failure==='start'&&!failed&&a[0]==='start'){failed=true;throw Error('start_failed');}return run(c,a);};
  x.deps.fs={...fs,renameSync:(a,b)=>{if(failure==='publish'&&!failed&&b.endsWith('/linux-pool-server.cjs')){failed=true;throw Error('rename_failed');}return fs.renameSync(a,b);}};
  await expect(install(x)).rejects.toThrow('linux_pool_install_failed');
  for(const[file,[value,mode]]of Object.entries(files)){expect(fs.readFileSync(path.join(x.root,file),'utf8')).toBe(value);expect(fs.statSync(path.join(x.root,file)).mode&0o777).toBe(mode);}
  expect(fs.existsSync(path.join(x.root,'usr/local/libexec/cecelia/fleet-worker/linux-cgroup.cjs'))).toBe(false);
  expect(x.calls).toContainEqual(['/usr/bin/systemctl',['start','cecelia-linux-pool.service']]);
 }finally{x.cleanup();}});
 it('他人锁不删除，不落盘',async()=>{const x=fixture();try{x.put('/run/lock/cecelia-linux-pool.install.lock','another-owner');await expect(install(x)).rejects.toThrow('linux_pool_install_locked');expect(fs.readFileSync(path.join(x.root,'run/lock/cecelia-linux-pool.install.lock'),'utf8')).toBe('another-owner');}finally{x.cleanup();}});
});
