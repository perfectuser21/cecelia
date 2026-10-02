'use strict';
// root-only 安装边界；依赖注入仅供文件系统事务测试，CLI 不接收 root/deps 参数。
const nativeFs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const {validateLinuxPoolProfile,renderLinuxUnits}=require('./linux-pool-profile.cjs');
const {parseCpuMax}=require('./linux-cgroup.cjs');
const FILES=Object.freeze(['linux-pool-canary.cjs','linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-resource-probe.cjs','linux-cgroup.cjs']);
const SERVICE='cecelia-linux-pool.service';
const BRIDGE='cecelia-linux-script.service';
const SCRIPT_FILES=['linux-script-canary.cjs','linux-script-service.cjs','linux-script-launch-gate.cjs','linux-script-runtime.cjs','linux-script-docker.cjs','linux-script-permit.cjs','linux-script-bridge.cjs','script-runner.cjs'];
const SCRIPT_UNIT='[Unit]\nDescription=Cecelia restricted script root bridge\nRequires=docker.service cecelia-workloads.slice\nAfter=docker.service cecelia-workloads.slice\nBefore=cecelia-linux-pool.service\n[Service]\nType=simple\nUser=root\nGroup=_cecelia\nExecStart=/usr/local/libexec/cecelia/toolchain/bin/node /usr/local/libexec/cecelia/fleet-worker/linux-script-service.cjs\nRestart=on-failure\nRestartSec=5\nRuntimeDirectory=cecelia-script\nRuntimeDirectoryMode=0750\nStateDirectory=cecelia/script-runtime\nStateDirectoryMode=0700\nNoNewPrivileges=yes\nCPUQuota=25%\nMemoryMax=268435456\nMemorySwapMax=0\nTasksMax=64\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n';
const SLICE='cecelia-workloads.slice';
const fail=code=>{throw Error(code);};
async function installLinuxPool(options,deps={}) {
 const fs=deps.fs??nativeFs,root=deps.root??'/',rootUid=deps.rootUid??0,rootGid=deps.rootGid??0;
 const real=name=>path.join(root,name);
 const run=deps.runCommand??((command,args)=>promisify(execFile)(command,args,{shell:false,timeout:15000,maxBuffer:65536,
  env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:'unix:///var/run/docker.sock'}}));
 const systemctl=args=>run('/usr/bin/systemctl',args);
 if((deps.platform??process.platform)!=='linux'||(deps.getuid??process.getuid)()!==0)fail('linux_pool_install_root_linux_required');
 if(!options||Object.keys(options).some(k=>!['sourceDir','profilePath','tokenPath','nodePath','revision','executionKeyPath','upgradePath','verifyOnly'].includes(k))
  ||!['sourceDir','profilePath','tokenPath','nodePath'].every(k=>typeof options[k]==='string'&&path.isAbsolute(options[k])&&!options[k].includes('\0')&&path.normalize(options[k])===options[k])
  ||!/^[a-f0-9]{40}$/.test(options.revision??''))fail('linux_pool_install_input_invalid');
 if(options.verifyOnly!==undefined&&(options.verifyOnly!==true||options.upgradePath===undefined))fail('linux_pool_install_input_invalid');
 const withBridge=options.executionKeyPath!==undefined,services=withBridge?[BRIDGE,SERVICE]:[SERVICE];
 if(options.upgradePath!==undefined&&(!withBridge||typeof options.upgradePath!=='string'||!path.isAbsolute(options.upgradePath)||path.normalize(options.upgradePath)!==options.upgradePath||options.upgradePath.includes('\0')))fail('linux_pool_install_input_invalid');
 if(withBridge&&(typeof options.executionKeyPath!=='string'||!path.isAbsolute(options.executionKeyPath)||path.normalize(options.executionKeyPath)!==options.executionKeyPath||options.executionKeyPath.includes('\0')))fail('linux_pool_install_input_invalid');
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
 async function serviceState(name){
  if(String((await systemctl(['show','--property=DropInPaths','--value',name,SLICE])).stdout).trim())fail('linux_pool_install_unit_override');
  const fields=String((await systemctl(['show','--property=LoadState,ActiveState,UnitFileState',name])).stdout).trim().split('\n').map(line=>line.split('='));
  const state=Object.fromEntries(fields);
  if(!['loaded','not-found'].includes(state.LoadState)||!['active','inactive'].includes(state.ActiveState)
   ||!['enabled','disabled',''].includes(state.UnitFileState))fail('linux_pool_install_service_unknown');
  return {active:state.ActiveState==='active',enabled:state.UnitFileState==='enabled'};
 }
 const serviceStates=async()=>{const result={};for(const name of services)result[name]=await serviceState(name);return result;};
 let profile,input,token,executionKey,node,source,units,account,prior;
 const upgradeFail=()=>fail('linux_pool_install_upgrade_unconfirmed');
 const hash=data=>createHash('sha256').update(data).digest('hex');
 const equalSecret=(a,b)=>a.length===b.length&&timingSafeEqual(a,b);
 let upgrade,upgradeLock=null,ownTransaction=null;
 function pseudo(name){
  const filename=real(name);let fd;
  try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const before=fs.fstatSync(fd);
   if(!before.isFile())upgradeFail();const buffer=Buffer.alloc(65537),size=fs.readSync(fd,buffer,0,buffer.length,0),after=fs.fstatSync(fd),current=fs.lstatSync(filename);
   if(size>65536||current.isSymbolicLink()||before.dev!==current.dev||before.ino!==current.ino||before.ctimeMs!==after.ctimeMs)upgradeFail();
   return buffer.subarray(0,size).toString();
  }finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 async function upgradeIdle({installed=true}={}){
  try{
   try{const held=fs.lstatSync(real('/run/cecelia/linux-pool.install.lock'));if(!upgradeLock||held.dev!==upgradeLock.dev||held.ino!==upgradeLock.ino)upgradeFail();}catch(e){if(e.code!=='ENOENT')throw e;}
   const recovery=real('/var/lib/cecelia/fleet-install');
   try{if(fs.readdirSync(recovery).some(name=>path.join(recovery,name)!==ownTransaction))upgradeFail();}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!upgrade){upgrade=JSON.parse(readFile(options.upgradePath,{mode:0o600,max:65536}).data);
    const keys=['schema_version','machine_registry_id','config_digest','revision','host_boot_id','daemon_id','worker_boot_id','source_sha256','intent_id'];
    if(Object.keys(upgrade).length!==keys.length||keys.some(k=>!Object.hasOwn(upgrade,k))||upgrade.schema_version!==1
     ||upgrade.machine_registry_id!==profile.machine_registry_id||upgrade.config_digest!==profile.config_digest
     ||!['host_boot_id','worker_boot_id','intent_id'].every(k=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(upgrade[k]??''))
     ||!/^[a-f0-9]{40}$/.test(upgrade.revision??'')||typeof upgrade.daemon_id!=='string'||!upgrade.daemon_id)upgradeFail();
    const names=[...FILES,...SCRIPT_FILES];
    if(!upgrade.source_sha256||Object.keys(upgrade.source_sha256).length!==names.length||names.some(n=>!/^[a-f0-9]{64}$/.test(upgrade.source_sha256[n]??'')))upgradeFail();
   }
   if(pseudo('/proc/sys/kernel/random/boot_id').trim()!==upgrade.host_boot_id)upgradeFail();
   const info=JSON.parse((await run('/usr/bin/docker',['info','--format','{{json .}}'])).stdout);
   if(info.ID!==upgrade.daemon_id||info.CgroupDriver!=='systemd'||info.CgroupVersion!=='2')upgradeFail();
   const cg='/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice',target=real(cg);secureParents(path.join(target,'cgroup.procs'));
   const stat=fs.lstatSync(target);
   if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==rootUid||(deps.statfs??(p=>fs.statfsSync(p)))(target).type!==0x63677270
    ||fs.readdirSync(target,{withFileTypes:true}).some(x=>x.isDirectory()||x.isSymbolicLink())||pseudo(cg+'/cgroup.procs').trim())upgradeFail();
   const events=pseudo(cg+'/cgroup.events').trim().split('\n');
   if(events.length!==2||!events.includes('populated 0')||!events.includes('frozen 0'))upgradeFail();
   if(parseCpuMax(pseudo(cg+'/cpu.max'),2)!==profile.pool.cpu_cores
    ||pseudo(cg+'/memory.max').trim()!==String(profile.pool.memory_bytes)||pseudo(cg+'/memory.swap.max').trim()!=='0'
    ||pseudo(cg+'/pids.max').trim()!==String(profile.pool.pids_limit))upgradeFail();
   if(String((await run('/usr/bin/docker',['ps','--filter','label=cecelia.script.machine_id='+profile.machine_id,'--format','{{.ID}}'])).stdout).trim())upgradeFail();
   const stateRoot='/var/lib/cecelia/script-runtime',directory=real(stateRoot);secureParents(path.join(directory,'entry'));
   const stateStat=fs.lstatSync(directory);if(!stateStat.isDirectory()||stateStat.isSymbolicLink()||stateStat.uid!==rootUid||(stateStat.mode&0o777)!==0o700)upgradeFail();
   for(const entry of fs.readdirSync(directory)){
    const match=entry.match(/^([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})(\.runtime\.json)?$/);if(!match)upgradeFail();
    const journal=JSON.parse(readFile(stateRoot+'/'+match[1]+'/'+match[1]+'.json',{mode:0o600,max:65536}).data);
    if(journal.status!=='cleaned')upgradeFail();
    if(match[2]){const record=JSON.parse(readFile(stateRoot+'/'+entry,{mode:0o600,max:65536}).data);if(record.identity?.machine_id!==profile.machine_id||record.identity?.reservation_id!==match[1])upgradeFail();}
   }
   if(!installed)for(const name of services){
    const stopped=Object.fromEntries(String((await systemctl(['show','--property=ActiveState,MainPID',name])).stdout).trim().split('\n').map(line=>line.split('=')));
    if(stopped.ActiveState!=='inactive'||stopped.MainPID!=='0')upgradeFail();
   }
   if(installed){
    if(readFile('/usr/local/libexec/cecelia/fleet-worker/revision',{mode:0o644}).data.toString().trim()!==upgrade.revision
     ||readFile('/run/cecelia-script/worker-boot-id',{mode:0o644}).data.toString().trim()!==upgrade.worker_boot_id)upgradeFail();
    for(const[name,digest]of Object.entries(upgrade.source_sha256))if(hash(readFile('/usr/local/libexec/cecelia/fleet-worker/'+name,{mode:0o644}).data)!==digest)upgradeFail();
    if(!equalSecret(readFile('/etc/cecelia/fleet-worker.token',{owner:account.uid,mode:0o600}).data,Buffer.from(token))
     ||!equalSecret(readFile('/etc/cecelia/script-execution.key',{mode:0o600}).data,Buffer.from(executionKey))
     ||hash(readFile('/usr/local/libexec/cecelia/toolchain/bin/node',{mode:0o755,max:134217728}).data)!==hash(node.data))upgradeFail();
    for(const[name,owner]of [['fleet-pool.json',account.uid],['script-pool.json',rootUid]]){
     const p=validateLinuxPoolProfile(JSON.parse(readFile('/etc/cecelia/'+name,{owner,mode:0o600}).data));if(p.config_digest!==profile.config_digest)upgradeFail();
    }
    const fixed={[SLICE]:units.slice,[SERVICE]:units.service.replace('[Unit]\n','[Unit]\nRequires='+BRIDGE+'\nAfter='+BRIDGE+'\n'),[BRIDGE]:SCRIPT_UNIT};
    for(const[name,data]of Object.entries(fixed))if(!readFile('/etc/systemd/system/'+name,{mode:0o644}).data.equals(Buffer.from(data)))upgradeFail();
    const sliceMeta=Object.fromEntries(String((await systemctl(['show','--property=FragmentPath,NeedDaemonReload',SLICE])).stdout).trim().split('\n').map(line=>line.split('=')));
    if(sliceMeta.FragmentPath!=='/etc/systemd/system/'+SLICE||sliceMeta.NeedDaemonReload!=='no')upgradeFail();
    for(const name of services){
     const meta=Object.fromEntries(String((await systemctl(['show','--property=FragmentPath,NeedDaemonReload,MainPID',name])).stdout).trim().split('\n').map(line=>line.split('=')));
     if(meta.FragmentPath!=='/etc/systemd/system/'+name||meta.NeedDaemonReload!=='no'||!/^\d+$/.test(meta.MainPID)||Number(meta.MainPID)<=1)upgradeFail();
     const module=name===BRIDGE?'linux-script-service.cjs':'linux-pool-server.cjs';
     if(pseudo('/proc/'+meta.MainPID+'/cmdline')!=='/usr/local/libexec/cecelia/toolchain/bin/node\0/usr/local/libexec/cecelia/fleet-worker/'+module+'\0')upgradeFail();
    }
   }
   if(fs.lstatSync(target).ino!==stat.ino||pseudo(cg+'/cgroup.procs').trim()||!pseudo(cg+'/cgroup.events').split('\n').includes('populated 0'))upgradeFail();
  }catch{upgradeFail();}
 }

 async function idle(afterStop=false){
  const state=String((await systemctl(['show','--property=ActiveState','--value',SLICE])).stdout).trim();
  if(options.upgradePath!==undefined){if(!['active','inactive'].includes(state))upgradeFail();return upgradeIdle({installed:!afterStop});}
  if(state!=='inactive')fail('linux_pool_install_pool_busy');
 }

 try{
  input=JSON.parse(readFile(options.profilePath,{mode:0o600,max:65536}).data.toString());
  profile=validateLinuxPoolProfile(input);
  units=renderLinuxUnits(profile); // US 身份/角色与零预算先拒；不先创建目录。
  token=readFile(options.tokenPath,{mode:0o600,max:65}).data.toString().trim();if(!/^[a-f0-9]{64}$/.test(token))fail('linux_pool_install_token_invalid');
  if(withBridge){executionKey=readFile(options.executionKeyPath,{mode:0o600,max:65}).data.toString().trim();if(!/^[a-f0-9]{64}$/.test(executionKey)||executionKey===token)fail('linux_pool_install_execution_key_invalid');}
  node=readFile(options.nodePath,{max:134217728});if(!(node.mode&0o111))fail('linux_pool_install_toolchain_invalid');
  source=[...FILES,...(withBridge?SCRIPT_FILES:[])].map(name=>({name,data:readFile(path.join(options.sourceDir,name)).data}));
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
  if(withBridge&&String((await run('/usr/bin/id',['-G','_cecelia'])).stdout).trim()!==String(account.gid))fail('linux_pool_install_account_required');
  await idle();
  prior=await serviceStates();
 }catch(error){if(error.message?.startsWith('linux_'))throw error;fail('linux_pool_install_preflight_failed');}
 if(options.verifyOnly)return {verified:true,execution:false,revision:upgrade.revision,config_digest:profile.config_digest};
 const entries=[
  ...source.map(({name,data})=>({name:'/usr/local/libexec/cecelia/fleet-worker/'+name,data,mode:0o644,uid:rootUid,gid:rootGid})),
  {name:'/usr/local/libexec/cecelia/fleet-worker/revision',data:Buffer.from(options.revision+'\n'),mode:0o644,uid:rootUid,gid:rootGid},
  {name:'/usr/local/libexec/cecelia/toolchain/bin/node',data:node.data,mode:0o755,uid:rootUid,gid:rootGid},
  {name:'/etc/cecelia/fleet-pool.json',data:Buffer.from(JSON.stringify(input)+'\n'),mode:0o600,...account},
  {name:'/etc/cecelia/fleet-worker.token',data:Buffer.from(token),mode:0o600,...account},
  {name:'/etc/systemd/system/'+SLICE,data:Buffer.from(units.slice),mode:0o644,uid:rootUid,gid:rootGid},
  {name:'/etc/systemd/system/'+SERVICE,data:Buffer.from(withBridge?units.service.replace('[Unit]\n','[Unit]\nRequires='+BRIDGE+'\nAfter='+BRIDGE+'\n'):units.service),mode:0o644,uid:rootUid,gid:rootGid},
  ...(withBridge?[
   {name:'/etc/cecelia/script-execution.key',data:Buffer.from(executionKey),mode:0o600,uid:rootUid,gid:rootGid},
   {name:'/etc/cecelia/script-pool.json',data:Buffer.from(JSON.stringify(input)+'\n'),mode:0o600,uid:rootUid,gid:rootGid},
   {name:'/etc/systemd/system/'+BRIDGE,data:Buffer.from(SCRIPT_UNIT),mode:0o644,uid:rootUid,gid:rootGid},
  ]:[]),
 ];
 const createdDirs=[],enableAttempted=new Set(),startAttempted=new Set();let lockFd,lockStat,stage,mutated=false,uncertain=false;
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
  lockStat=fs.fstatSync(lockFd);upgradeLock={dev:lockStat.dev,ino:lockStat.ino};fs.writeFileSync(lockFd,randomUUID());fs.fsyncSync(lockFd);
  // 锁后重新检查池；其它root管理器仍需遵守同一维护协议。
  await idle();
  prior=await serviceStates();
  for(const entry of entries){mkdir(path.dirname(entry.name));let snapshot=null;try{snapshot=readFile(entry.name,{owner:entry.uid,mode:entry.mode,max:134217728});}catch(error){if(error.code!=='ENOENT')throw error;}originals.set(entry.name,snapshot);}
  mkdir('/var/lib/cecelia/fleet-install');stage=real('/var/lib/cecelia/fleet-install/txn-'+randomUUID());fs.mkdirSync(stage,{mode:0o700});ownTransaction=stage;
  for(const[name,snapshot]of originals){if(snapshot){const target=path.join(stage,String([...originals.keys()].indexOf(name)));const fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,snapshot.data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}}syncDir(stage);
  const manifest={schema_version:1,prior,...(upgrade?{upgrade_intent_id:upgrade.intent_id}:{}),entries:[...originals].map(([name,snapshot],index)=>({name,backup:snapshot?String(index):null,...(snapshot?{mode:snapshot.mode,uid:snapshot.uid,gid:snapshot.gid}:{})}))};
  const manifestFd=fs.openSync(path.join(stage,'manifest.json'),'wx',0o600);try{fs.writeFileSync(manifestFd,JSON.stringify(manifest));fs.fsyncSync(manifestFd);}finally{fs.closeSync(manifestFd);}syncDir(stage);
  await idle();
  mutated=true;for(const name of [...services].reverse())if(prior[name].active)await systemctl(['stop',name]);
  if(upgrade)await idle(true);
  for(const entry of entries)publish(entry);
  await systemctl(['daemon-reload']);
  for(const name of services){enableAttempted.add(name);await systemctl(['enable',name]);startAttempted.add(name);await systemctl(['start',name]);
   if(String((await systemctl(['is-active',name])).stdout).trim()!=='active')fail('linux_pool_install_service_unavailable');}
  return {installed:true,execution:false,revision:options.revision,config_digest:profile.config_digest,service:SERVICE};
 }catch(error){
  if(mutated){
   try{
    for(const name of [...services].reverse())if(prior[name].active||startAttempted.has(name))await systemctl(['stop',name]);
    // 新启用产生的链接先撤销，unit文件仍存在时systemd才能解析它。
    for(const name of [...services].reverse())if(enableAttempted.has(name)&&!prior[name].enabled)await systemctl(['disable',name]);
    for(const[name,snapshot]of originals){if(snapshot)publish({name,...snapshot});else {try{fs.unlinkSync(real(name));syncDir(path.dirname(real(name)));}catch(e){if(e.code!=='ENOENT')throw e;}}}
    await systemctl(['daemon-reload']);for(const name of services){if(prior[name].enabled)await systemctl(['enable',name]);if(prior[name].active)await systemctl(['start',name]);}
   }catch{stage=null;uncertain=true;fail('linux_pool_install_rollback_failed');}
   fail('linux_pool_install_failed');
  }
  if(error.message?.startsWith('linux_'))throw error;fail('linux_pool_install_failed');
 }finally{
  if(stage)fs.rmSync(stage,{recursive:true,force:true});
  if(lockFd!==undefined){fs.closeSync(lockFd);const current=fs.lstatSync(real(lock));if(!uncertain&&current.dev===lockStat.dev&&current.ino===lockStat.ino)fs.unlinkSync(real(lock));}
  for(const dir of createdDirs.reverse()){try{fs.rmdirSync(dir);}catch(error){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code))throw error;}}
 }
}
if(require.main===module){
 const args=process.argv.slice(2),keys={'--source-dir':'sourceDir','--profile-file':'profilePath','--token-file':'tokenPath','--node-path':'nodePath','--revision':'revision','--execution-key-file':'executionKeyPath','--upgrade-file':'upgradePath'},options={};
 try{if(args.at(-1)==='--verify-only'){args.pop();options.verifyOnly=true;}if(![10,12,14].includes(args.length))fail('linux_pool_install_input_invalid');for(let i=0;i<args.length;i+=2){const key=Object.hasOwn(keys,args[i])?keys[args[i]]:null;if(!key||Object.hasOwn(options,key))fail('linux_pool_install_input_invalid');options[key]=args[i+1];}
  installLinuxPool(options).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write((error.message.startsWith('linux_')?error.message:'linux_pool_install_failed')+'\n');process.exitCode=1;});
 }catch{process.stderr.write('linux_pool_install_input_invalid\n');process.exitCode=1;}
}
module.exports={installLinuxPool};
