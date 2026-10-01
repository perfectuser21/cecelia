'use strict';
// 仅供可信 SSH/root 验收器调用；HTTP 请求不能提供 deps 或宿主证明。
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {sampleLinuxResources,readBounded}=require('./linux-resource-probe.cjs');
const {parseCpuMax,parseMemoryLimit,locateHierarchy,unsigned}=require('./linux-cgroup.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const ERROR='linux_pool_proof_unavailable';
const fail=()=>{throw Error(ERROR);};
const MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
function profileInput(profile) {
  return Object.fromEntries(['schema_version','machine_registry_id','machine_id','role','endpoint_host','docker_host','pool','canary_image']
    .map(key=>[key,profile?.[key]]));
}
function pidIdentity(raw,pid) {
  const end=raw.lastIndexOf(')');
  if(!raw.startsWith(pid+' (')||end<0)fail();
  const fields=raw.slice(end+1).trim().split(/\s+/);
  if(!/^\d{1,20}$/.test(fields[19]??''))fail();
  return fields[19];
}
function verifyContainer(value,expected,profile,imageId,policy) {
  const h=value?.HostConfig,s=value?.State;
  if(value?.Id!==expected.container_id||value.Name!=='/'+expected.name||value.Image!==imageId
    ||value.Config?.Image!==policy.image||value.Config?.User!==policy.user
    ||!Object.entries(expected.labels).every(([key,label])=>value.Config?.Labels?.[key]===label)
    ||s?.Running!==true||!Number.isSafeInteger(s.Pid)||s.Pid<2
    ||h?.CgroupParent!==profile.cgroup_parent||h.Privileged!==false||h.ReadonlyRootfs!==true||h.NetworkMode!=='none'
    ||!Array.isArray(value.Mounts)||value.Mounts.length!==0
    ||!Array.isArray(h.CapDrop)||h.CapDrop.length!==1||h.CapDrop[0]!=='ALL'
    ||!Array.isArray(h.SecurityOpt)||h.SecurityOpt.length!==1||h.SecurityOpt[0]!=='no-new-privileges'
    ||['Binds','Devices','DeviceRequests','CapAdd'].some(key=>h[key]!=null&&(!Array.isArray(h[key])||h[key].length))
    ||['PidMode','UTSMode','UsernsMode'].some(key=>h[key]!=null&&!['','private'].includes(h[key]))
    ||h.IpcMode!=null&&!['','private'].includes(h.IpcMode)
    ||!Number.isSafeInteger(h.NanoCpus)||h.NanoCpus<=0||h.NanoCpus>profile.pool.cpu_cores*1e9
    ||!Number.isSafeInteger(h.Memory)||h.Memory<=0||h.Memory>profile.pool.memory_bytes||h.MemorySwap!==h.Memory
    ||!Number.isSafeInteger(h.PidsLimit)||h.PidsLimit<=0||h.PidsLimit>profile.pool.pids_limit)fail();
  if(policy.script&&(value.Config.WorkingDir!==policy.script.cwd||h.NanoCpus!==policy.script.cpus*1e9
    ||h.Memory!==policy.script.memoryBytes||h.PidsLimit!==policy.script.pidsLimit
    ||h.LogConfig?.Type!=='local'||h.LogConfig.Config?.['max-size']!==String(policy.script.logMaxSizeBytes)
    ||h.LogConfig.Config?.['max-file']!==String(policy.script.logMaxFiles)))fail();
  return s.Pid;
}
async function collectContainerProof({profile:input,expected,policy,deps={}}) {
  try {
    const profile=validateLinuxPoolProfile(profileInput(input));
    if(!profile.execution_budget_available||(deps.getuid??process.getuid)()!==0
      ||typeof expected?.container_id!=='string'||!/^[a-f0-9]{64}$/.test(expected.container_id)
)fail();
    const rawRead=deps.readText??readBounded,readlink=deps.readlink??fs.readlink;
    const staticFiles=new Map();
    const read=async filename=>{
      const track=/\/(?:cpu\.max|memory\.max|memory\.high|memory\.swap\.max|cpuset\.cpus\.effective|pids\.max)$/.test(filename)
        ||filename==='/sys/devices/system/cpu/online';
      let value;
      try{value=await rawRead(filename);}catch(error){if(!track||error.code!=='ENOENT')throw error;value=null;}
      if(track){if(staticFiles.has(filename)&&staticFiles.get(filename)!==value)fail();staticFiles.set(filename,value);}
      if(value===null)throw Object.assign(Error(),{code:'ENOENT'});
      return value;
    };
    const run=deps.runCommand??((command,args)=>promisify(execFile)(command,args,{shell:false,timeout:5000,maxBuffer:65536,
      env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:profile.docker_host}}));
    if(!['/usr/lib/systemd/systemd','/lib/systemd/systemd'].includes(await readlink('/proc/1/exe')))fail();
    // 容器内root和namespace根不足以证明宿主祖先可见。首版只接收完整VM/宿主systemd环境。
    let noContainer=false;
    try{await run('/usr/bin/systemd-detect-virt',['--container']);}
    catch(error){noContainer=error.code===1&&String(error.stdout).trim()==='none';}
    if(!noContainer)fail();
    const docker=async args=>(await run('/usr/bin/docker',args)).stdout;
    const boot=(await read('/proc/sys/kernel/random/boot_id')).trim();
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(boot)||policy.hostBootId&&boot!==policy.hostBootId)fail();
    const namespaces={};
    for(const kind of ['cgroup','pid','mnt']) {
      namespaces[kind]=await readlink('/proc/1/ns/'+kind);
      if(!new RegExp('^'+kind+':\\[\\d+\\]$').test(namespaces[kind])||await readlink('/proc/self/ns/'+kind)!==namespaces[kind])fail();
    }
    const getInfo=async()=>JSON.parse(await docker(['info','--format','{{json .}}']));
    const info=await getInfo();
    if(info.CgroupDriver!=='systemd'||info.CgroupVersion!=='2'||typeof info.ID!=='string'||!info.ID||info.ID.length>256
      ||policy.daemonId&&info.ID!==policy.daemonId
      ||typeof info.DockerRootDir!=='string'||!info.DockerRootDir.startsWith('/')||info.DockerRootDir.includes('\0'))fail();
    const poolPath=(await run('/usr/bin/systemctl',['show','--property=ControlGroup','--value',profile.cgroup_parent])).stdout.trim();
    if(poolPath!=='/cecelia.slice/cecelia-workloads.slice')fail();
    const imageId=(await docker(['image','inspect','--format','{{.Id}}',policy.image])).trim();
    if(!/^sha256:[a-f0-9]{64}$/.test(imageId))fail();
    const inspect=async()=>{
      const values=JSON.parse(await docker(['inspect','--type=container',expected.container_id]));
      if(!Array.isArray(values)||values.length!==1)fail();
      return verifyContainer(values[0],expected,profile,imageId,policy);
    };
    const pid=await inspect(),membership=await read('/proc/'+pid+'/cgroup');
    if(membership.trim()!=='0::'+poolPath+'/docker-'+expected.container_id+'.scope')fail();
    const birth=pidIdentity(await read('/proc/'+pid+'/stat'),pid);
    const mounts=await read('/proc/self/mountinfo');
    const poolMembership='0::'+poolPath+'\n';
    const hierarchy=locateHierarchy(poolMembership,mounts,'memory');
    if(hierarchy.version!==2||!hierarchy.rootVisible||hierarchy.mount!=='/sys/fs/cgroup')fail();
    for(const line of mounts.trim().split('\n')) {
      const mount=line.split(' - ')[0].split(' ')[4]?.replace(/\\(040|011|012|134)/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
      if(mount?.startsWith(hierarchy.mount+'/'))fail();
    }
    const statfs=deps.statfs??(filename=>fs.statfs(filename,{bigint:true}));
    for(const ancestor of hierarchy.paths)if((await statfs(ancestor)).type!==0x63677270n)fail();
    const directory=hierarchy.paths[0];
    const poolLimits=async()=>({cpu:await read(directory+'/cpu.max'),memory:await read(directory+'/memory.max'),
      swap:await read(directory+'/memory.swap.max'),pids:await read(directory+'/pids.max')});
    const limits=await poolLimits();
    if(parseCpuMax(limits.cpu)!==profile.pool.cpu_cores||parseMemoryLimit(limits.memory)!==BigInt(profile.pool.memory_bytes)
      ||unsigned(limits.swap)!==0n||unsigned(limits.pids)!==BigInt(profile.pool.pids_limit))fail();
    const observation=await sampleLinuxResources({readText:filename=>filename==='/proc/self/cgroup'?Promise.resolve(poolMembership):read(filename),
      statfs:deps.statfs,diskPaths:[profile.data_root,info.DockerRootDir]});
    if(observation.status!=='observed')fail();
    let pidsLimit=BigInt(profile.pool.pids_limit),pidsAvailable=pidsLimit;
    for(const ancestor of hierarchy.paths) {
      let raw;
      try{raw=(await read(ancestor+'/pids.max')).trim();}
      catch(error){if(ancestor===hierarchy.mount&&error.code==='ENOENT')continue;throw error;}
      if(raw==='max')continue;
      const limit=unsigned(raw),used=unsigned(await read(ancestor+'/pids.current'));
      if(limit>MAX_SAFE)fail();
      pidsLimit=pidsLimit<limit?pidsLimit:limit;
      const available=used>limit?0n:limit-used;pidsAvailable=pidsAvailable<available?pidsAvailable:available;
    }
    if((await read('/proc/sys/kernel/random/boot_id')).trim()!==boot
      ||await read('/proc/'+pid+'/cgroup')!==membership||pidIdentity(await read('/proc/'+pid+'/stat'),pid)!==birth
      ||await inspect()!==pid||JSON.stringify(await poolLimits())!==JSON.stringify(limits)
      ||await read('/proc/self/mountinfo')!==mounts)fail();
    for(const kind of Object.keys(namespaces))if(await readlink('/proc/1/ns/'+kind)!==namespaces[kind]
      ||await readlink('/proc/self/ns/'+kind)!==namespaces[kind])fail();
    for(const [filename,value] of staticFiles){
      let current;
      try{current=await rawRead(filename);}catch(error){if(error.code!=='ENOENT')throw error;current=null;}
      if(current!==value)fail();
    }
    const finalInfo=await getInfo();
    if(['ID','DockerRootDir','CgroupDriver','CgroupVersion'].some(key=>finalInfo[key]!==info[key]))fail();
    for(const ancestor of hierarchy.paths)if((await statfs(ancestor)).type!==0x63677270n)fail();
    return {schema_version:'linux-pool-proof/v1',execution:false,pool_verified:true,
      machine_registry_id:profile.machine_registry_id,config_digest:profile.config_digest,
      host_boot_id:boot,host_cgroup_namespace:namespaces.cgroup,daemon_id:info.ID,container_id:expected.container_id,
      container_pid:pid,container_start_time:birth,cgroup_parent:profile.cgroup_parent,cgroup_parent_path:poolPath,
      observed_at:observation.observed_at,cpu_cores:observation.cpu_cores,memory_limit_bytes:observation.memory_limit_bytes,
      memory_available_bytes:observation.memory_available_bytes,pids_limit:Number(pidsLimit),pids_available:Number(pidsAvailable),
      disk_free_bytes:observation.disk_free_bytes,disk_used_percent:observation.disk_used_percent};
  } catch {throw Error(ERROR);}
}
async function collectLinuxPoolProof({profile,expected,deps={}}) {
  try {
    if(typeof expected?.name!=='string'||!/^cecelia-pool-canary-[a-z0-9-]{1,80}$/.test(expected.name)
      ||!expected.labels||typeof expected.labels!=='object'||Array.isArray(expected.labels)
      ||!Object.keys(expected.labels).length||Object.entries(expected.labels).some(([k,v])=>!k.startsWith('cecelia.pool.')||typeof v!=='string'||!v||v.length>256))fail();
    const validated=validateLinuxPoolProfile(profileInput(profile));
    return await collectContainerProof({profile:validated,expected,policy:{image:validated.canary_image,user:'65534:65534'},deps});
  }catch{throw Error(ERROR);}
}
// 事实采集入口只接受可信执行桥的持久身份/profile；它不读取HTTP请求或签发执行许可。
async function collectLinuxScriptProof({profile,scriptProfile,identity,containerId,expectedHostBootId,expectedDaemonId,deps={}}) {
  try {
    const p=validateLinuxPoolProfile(profileInput(profile));
    const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
    const keys=['reservation_id','intent_id','launch_generation','machine_id','owner_key','config_digest','worker_id','worker_boot_id','execution_version_id','execution_grant_id','profile_id'];
    if(!identity||Object.keys(identity).length!==keys.length||keys.some(k=>!Object.hasOwn(identity,k))
      ||['reservation_id','intent_id','worker_boot_id','execution_version_id','execution_grant_id'].some(k=>!uuid(identity[k]))
      ||identity.machine_id!==p.machine_id||identity.worker_id!==p.machine_id
      ||!Number.isSafeInteger(identity.launch_generation)||identity.launch_generation<1
      ||typeof identity.owner_key!=='string'||!/^script-[a-f0-9-]+-a[1-9][0-9]*$/.test(identity.owner_key)
      ||typeof identity.config_digest!=='string'||!/^[a-f0-9]{64}$/.test(identity.config_digest)
      ||typeof identity.profile_id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(identity.profile_id)
      ||!uuid(expectedHostBootId)||typeof expectedDaemonId!=='string'||!expectedDaemonId||expectedDaemonId.length>256)fail();
    const skeys=['image','cpus','memoryBytes','pidsLimit','logMaxSizeBytes','logMaxFiles','user','cwd'];
    if(!scriptProfile||Object.keys(scriptProfile).length!==skeys.length||skeys.some(k=>!Object.hasOwn(scriptProfile,k)))fail();
    const script={...scriptProfile},bound={...identity};
    if(typeof script.image!=='string'||!/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(script.image)
      ||!Number.isFinite(script.cpus)||script.cpus<=0||script.cpus>p.pool.cpu_cores||!Number.isSafeInteger(script.cpus*1e9)
      ||['memoryBytes','pidsLimit','logMaxSizeBytes','logMaxFiles'].some(k=>!Number.isSafeInteger(script[k])||script[k]<=0)
      ||script.memoryBytes>p.pool.memory_bytes||script.pidsLimit>p.pool.pids_limit
      ||typeof script.user!=='string'||! /^[1-9][0-9]*:[1-9][0-9]*$/.test(script.user)
      ||typeof script.cwd!=='string'||!script.cwd.startsWith('/')||script.cwd.includes('..')||script.cwd.includes('\0'))fail();
    const profileDigest=createHash('sha256').update(JSON.stringify(script)).digest('hex');
    const labels=Object.fromEntries(Object.entries(bound).map(([key,value])=>['cecelia.script.'+key,String(value)]));
    labels['cecelia.script.profile_digest']=profileDigest;
    const expected={container_id:containerId,name:`cecelia-script-${bound.reservation_id}-g${bound.launch_generation}`,labels};
    const proof=await collectContainerProof({profile:p,expected,policy:{image:script.image,user:script.user,script,hostBootId:expectedHostBootId,daemonId:expectedDaemonId},deps});
    return {...proof,schema_version:'linux-script-proof/v1',script_verified:true,identity:bound,profile_digest:profileDigest};
  }catch{throw Error('linux_script_proof_unavailable');}
}
module.exports={collectLinuxPoolProof,collectLinuxScriptProof};
