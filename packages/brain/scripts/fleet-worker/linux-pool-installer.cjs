'use strict';
// root-only 安装边界；依赖注入仅供文件系统事务测试，CLI 不接收 root/deps 参数。
const nativeFs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {randomUUID}=require('node:crypto');
const {validateLinuxPoolProfile,renderLinuxUnits}=require('./linux-pool-profile.cjs');
const FILES=Object.freeze(['linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-resource-probe.cjs','linux-cgroup.cjs']);
const SERVICE='cecelia-linux-pool.service';
const SLICE='cecelia-workloads.slice';
const fail=code=>{throw Error(code);};
async function installLinuxPool(options,deps={}) {
 const fs=deps.fs??nativeFs,root=deps.root??'/',rootUid=deps.rootUid??0,rootGid=deps.rootGid??0;
 const real=name=>path.join(root,name);
 const run=deps.runCommand??((command,args)=>promisify(execFile)(command,args,{shell:false,timeout:15000,maxBuffer:65536,
  env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:'unix:///var/run/docker.sock'}}));
 const systemctl=args=>run('/usr/bin/systemctl',args);
 if((deps.platform??process.platform)!=='linux'||(deps.getuid??process.getuid)()!==0)fail('linux_pool_install_root_linux_required');
 if(!options||Object.keys(options).some(k=>!['sourceDir','profilePath','tokenPath','nodePath','revision'].includes(k))
  ||!['sourceDir','profilePath','tokenPath','nodePath'].every(k=>typeof options[k]==='string'&&path.isAbsolute(options[k])&&!options[k].includes('\0')&&path.normalize(options[k])===options[k])
  ||!/^[a-f0-9]{40}$/.test(options.revision??''))fail('linux_pool_install_input_invalid');
 function secureParents(filename){
  let current=path.dirname(filename);
  for(;;){const s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==rootUid||(s.mode&0o022))fail('linux_pool_install_untrusted_path');
   if(current===root||current==='/')break;current=path.dirname(current);}
 }
 function readFile(name,{owner=rootUid,mode,max=1048576}={}){
  const filename=real(name);secureParents(filename);let fd;
  try{
   fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=fs.fstatSync(fd,{bigint:true});
   if(!before.isFile()||before.uid!==BigInt(owner)||before.nlink!==1n||before.size>BigInt(max)
    ||(mode!==undefined?(before.mode&0o777n)!==BigInt(mode):(before.mode&0o022n)!==0n))fail('linux_pool_install_untrusted_file');
   const buffer=Buffer.alloc(Number(before.size)+1),count=fs.readSync(fd,buffer,0,buffer.length,0);
   const after=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(filename,{bigint:true});
   if(BigInt(count)!==before.size||before.ctimeNs!==after.ctimeNs||before.size!==after.size
    ||before.ino!==current.ino||before.dev!==current.dev||before.ctimeNs!==current.ctimeNs||current.isSymbolicLink())fail('linux_pool_install_untrusted_file');
   return {data:buffer.subarray(0,count),mode:Number(before.mode&0o777n),uid:Number(before.uid),gid:Number(before.gid)};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 async function serviceState(){
  if(String((await systemctl(['show','--property=DropInPaths','--value',SERVICE,SLICE])).stdout).trim())fail('linux_pool_install_unit_override');
  const fields=String((await systemctl(['show','--property=LoadState,ActiveState,UnitFileState',SERVICE])).stdout).trim().split('\n').map(line=>line.split('='));
  const state=Object.fromEntries(fields);
  if(!['loaded','not-found'].includes(state.LoadState)||!['active','inactive'].includes(state.ActiveState)
   ||!['enabled','disabled',''].includes(state.UnitFileState))fail('linux_pool_install_service_unknown');
  return {active:state.ActiveState==='active',enabled:state.UnitFileState==='enabled'};
 }
 let profile,input,token,node,source,units,account,prior;
 try{
  input=JSON.parse(readFile(options.profilePath,{mode:0o600,max:65536}).data.toString());
  profile=validateLinuxPoolProfile(input);
  units=renderLinuxUnits(profile); // US 身份/角色与零预算先拒；不先创建目录。
  token=readFile(options.tokenPath,{mode:0o600,max:65}).data.toString().trim();if(!/^[a-f0-9]{64}$/.test(token))fail('linux_pool_install_token_invalid');
  node=readFile(options.nodePath,{max:134217728});if(!(node.mode&0o111))fail('linux_pool_install_toolchain_invalid');
  source=FILES.map(name=>({name,data:readFile(path.join(options.sourceDir,name)).data}));
  if(!['/usr/lib/systemd/systemd','/lib/systemd/systemd'].includes(await(deps.readlink??fs.promises.readlink)('/proc/1/exe')))fail('linux_pool_install_host_unavailable');
  let host=false;try{await run('/usr/bin/systemd-detect-virt',['--container']);}catch(error){host=error.code===1&&String(error.stdout).trim()==='none';}
  if(!host)fail('linux_pool_install_host_unavailable');
  const info=JSON.parse((await run('/usr/bin/docker',['info','--format','{{json .}}'])).stdout);
  if(info.CgroupDriver!=='systemd'||info.CgroupVersion!=='2'||typeof info.ID!=='string'||!info.ID)fail('linux_pool_install_daemon_unavailable');
  const version=String((await run(options.nodePath,['--version'])).stdout).trim();if(!/^v24\.\d+\.\d+$/.test(version))fail('linux_pool_install_toolchain_invalid');
  const record=String((await run('/usr/bin/getent',['passwd','_cecelia'])).stdout).trim().split(':');
  account={uid:Number(record[2]),gid:Number(record[3])};
  if(record.length!==7||record[0]!=='_cecelia'||!Number.isSafeInteger(account.uid)||account.uid<=0||!Number.isSafeInteger(account.gid)||account.gid<=0
   ||!['/usr/sbin/nologin','/sbin/nologin','/bin/false'].includes(record[6]))fail('linux_pool_install_account_required');
  const group=String((await run('/usr/bin/getent',['group','_cecelia'])).stdout).trim().split(':');
  if(group.length!==4||group[0]!=='_cecelia'||Number(group[2])!==account.gid)fail('linux_pool_install_account_required');
  if(String((await systemctl(['show','--property=ActiveState','--value',SLICE])).stdout).trim()!=='inactive')fail('linux_pool_install_pool_busy');
  prior=await serviceState();
 }catch(error){if(error.message?.startsWith('linux_'))throw error;fail('linux_pool_install_preflight_failed');}
 const entries=[
  ...source.map(({name,data})=>({name:'/usr/local/libexec/cecelia/fleet-worker/'+name,data,mode:0o644,uid:rootUid,gid:rootGid})),
  {name:'/usr/local/libexec/cecelia/fleet-worker/revision',data:Buffer.from(options.revision+'\n'),mode:0o644,uid:rootUid,gid:rootGid},
  {name:'/usr/local/libexec/cecelia/toolchain/bin/node',data:node.data,mode:0o755,uid:rootUid,gid:rootGid},
  {name:'/etc/cecelia/fleet-pool.json',data:Buffer.from(JSON.stringify(input)+'\n'),mode:0o600,...account},
  {name:'/etc/cecelia/fleet-worker.token',data:Buffer.from(token),mode:0o600,...account},
  {name:'/etc/systemd/system/'+SLICE,data:Buffer.from(units.slice),mode:0o644,uid:rootUid,gid:rootGid},
  {name:'/etc/systemd/system/'+SERVICE,data:Buffer.from(units.service),mode:0o644,uid:rootUid,gid:rootGid},
 ];
 const createdDirs=[];let lockFd,lockStat,stage,mutated=false,enableAttempted=false;
 const lock='/run/cecelia/linux-pool.install.lock',originals=new Map();
 function mkdir(name){
  const target=real(name);if(fs.existsSync(target)){const s=fs.lstatSync(target);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==rootUid||(s.mode&0o022))fail('linux_pool_install_untrusted_path');return;}
  if(name!=='/')mkdir(path.dirname(name));fs.mkdirSync(target,{mode:0o755});createdDirs.push(target);
 }
 function syncDir(name){const fd=fs.openSync(name,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 function publish(entry){
  const dest=real(entry.name),temp=path.join(path.dirname(dest),'.linux-pool-'+randomUUID());let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,entry.data);fs.fchownSync(fd,entry.uid,entry.gid);fs.fchmodSync(fd,entry.mode);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,dest);syncDir(path.dirname(dest));}
  finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
 try{
  mkdir('/run/cecelia');
  try{lockFd=fs.openSync(real(lock),'wx',0o600);}catch(error){if(error.code==='EEXIST')fail('linux_pool_install_locked');throw error;}
  lockStat=fs.fstatSync(lockFd);fs.writeFileSync(lockFd,randomUUID());fs.fsyncSync(lockFd);
  // 锁后重新检查池；其它root管理器仍需遵守同一维护协议。
  if(String((await systemctl(['show','--property=ActiveState','--value',SLICE])).stdout).trim()!=='inactive')fail('linux_pool_install_pool_busy');
  prior=await serviceState();
  for(const entry of entries){mkdir(path.dirname(entry.name));let snapshot=null;try{snapshot=readFile(entry.name,{owner:entry.uid,mode:entry.mode,max:134217728});}catch(error){if(error.code!=='ENOENT')throw error;}originals.set(entry.name,snapshot);}
  mkdir('/var/lib/cecelia/fleet-install');stage=real('/var/lib/cecelia/fleet-install/txn-'+randomUUID());fs.mkdirSync(stage,{mode:0o700});
  for(const[name,snapshot]of originals){if(snapshot){const target=path.join(stage,String([...originals.keys()].indexOf(name)));const fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,snapshot.data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}syncDir(stage);
  const manifest={schema_version:1,prior,entries:[...originals].map(([name,snapshot],index)=>({name,backup:snapshot?String(index):null,...(snapshot?{mode:snapshot.mode,uid:snapshot.uid,gid:snapshot.gid}:{})}))};
  const manifestFd=fs.openSync(path.join(stage,'manifest.json'),'wx',0o600);try{fs.writeFileSync(manifestFd,JSON.stringify(manifest));fs.fsyncSync(manifestFd);}finally{fs.closeSync(manifestFd);}syncDir(stage);
  mutated=true;if(prior.active)await systemctl(['stop',SERVICE]);
  for(const entry of entries)publish(entry);
  await systemctl(['daemon-reload']);enableAttempted=true;await systemctl(['enable',SERVICE]);await systemctl(['start',SERVICE]);
  if(String((await systemctl(['is-active',SERVICE])).stdout).trim()!=='active')fail('linux_pool_install_service_unavailable');
  return {installed:true,execution:false,revision:options.revision,config_digest:profile.config_digest,service:SERVICE};
 }catch(error){
  if(mutated){
   try{
    await systemctl(['stop',SERVICE]);
    // 新启用产生的链接先撤销，unit文件仍存在时systemd才能解析它。
    if(enableAttempted&&!prior.enabled)await systemctl(['disable',SERVICE]);
    for(const[name,snapshot]of originals){if(snapshot)publish({name,...snapshot});else {try{fs.unlinkSync(real(name));syncDir(path.dirname(real(name)));}catch(e){if(e.code!=='ENOENT')throw e;}}}
    await systemctl(['daemon-reload']);if(prior.enabled)await systemctl(['enable',SERVICE]);if(prior.active)await systemctl(['start',SERVICE]);
   }catch{stage=null;fail('linux_pool_install_rollback_failed');}
   fail('linux_pool_install_failed');
  }
  if(error.message?.startsWith('linux_'))throw error;fail('linux_pool_install_failed');
 }finally{
  if(stage)fs.rmSync(stage,{recursive:true,force:true});
  if(lockFd!==undefined){fs.closeSync(lockFd);const current=fs.lstatSync(real(lock));if(current.dev===lockStat.dev&&current.ino===lockStat.ino)fs.unlinkSync(real(lock));}
  for(const dir of createdDirs.reverse()){try{fs.rmdirSync(dir);}catch(error){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code))throw error;}}
 }
}
if(require.main===module){
 const args=process.argv.slice(2),keys={'--source-dir':'sourceDir','--profile-file':'profilePath','--token-file':'tokenPath','--node-path':'nodePath','--revision':'revision'},options={};
 try{if(args.length!==10)fail('linux_pool_install_input_invalid');for(let i=0;i<args.length;i+=2){const key=Object.hasOwn(keys,args[i])?keys[args[i]]:null;if(!key||Object.hasOwn(options,key))fail('linux_pool_install_input_invalid');options[key]=args[i+1];}
  installLinuxPool(options).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write((error.message.startsWith('linux_')?error.message:'linux_pool_install_failed')+'\n');process.exitCode=1;});
 }catch{process.stderr.write('linux_pool_install_input_invalid\n');process.exitCode=1;}
}
module.exports={installLinuxPool};
