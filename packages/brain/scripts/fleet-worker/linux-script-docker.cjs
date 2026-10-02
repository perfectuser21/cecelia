'use strict';
// 仅受信root桥内部构造；load/save读取root journal，绝不接受HTTP传入这些依赖。
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ID=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(code='identity_mismatch')=>{throw Error('linux_script_'+code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const IDENTITY=['reservation_id','intent_id','launch_generation','machine_id','owner_key','config_digest','worker_id','worker_boot_id','execution_version_id','execution_grant_id','profile_id'];
const PROFILE=['image','cpus','memoryBytes','pidsLimit','logMaxSizeBytes','logMaxFiles','user','cwd'];
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));}
function validateRuntime(value) {
 const r=structuredClone(value),i=r?.identity,p=r?.profile;
 if(!exact(i,IDENTITY)||!exact(p,PROFILE)||!ID.test(r.job_digest)||!Number.isInteger(r.timeout_sec)||r.timeout_sec<1||r.timeout_sec>3600||Object.hasOwn(r,'job'))fail();
 const pool=validateLinuxPoolProfile(r.pool);
 if(!pool.execution_budget_available||i.machine_id!==pool.machine_id||i.worker_id!==pool.machine_id
  ||['reservation_id','intent_id','worker_boot_id','execution_version_id','execution_grant_id'].some(k=>!UUID.test(i[k]))
  ||!Number.isSafeInteger(i.launch_generation)||i.launch_generation<1||!/^script-[a-f0-9-]+-a[1-9][0-9]*$/.test(i.owner_key)
  ||typeof i.profile_id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(i.profile_id)
  ||typeof p.image!=='string'||!/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(p.image)
  ||!Number.isFinite(p.cpus)||p.cpus<=0||p.cpus>pool.pool.cpu_cores||!Number.isSafeInteger(p.cpus*1e9)
  ||['memoryBytes','pidsLimit','logMaxSizeBytes','logMaxFiles'].some(k=>!Number.isSafeInteger(p[k])||p[k]<=0)
  ||p.memoryBytes>pool.pool.memory_bytes||p.pidsLimit>pool.pool.pids_limit||! /^[1-9][0-9]*:[1-9][0-9]*$/.test(p.user)
  ||typeof p.cwd!=='string'||!p.cwd.startsWith('/')||p.cwd.includes('..')||p.cwd.includes('\0')
  ||!ID.test(i.config_digest)||!/^sha256:[a-f0-9]{64}$/.test(r.image_id)
  ||typeof r.daemon_id!=='string'||!r.daemon_id||r.daemon_id.length>256
  ||!['planned','creating','bound'].includes(r.phase)||(r.phase==='bound'?!ID.test(r.container_id):r.container_id!==null))fail();
 return r;
}
const containerName=r=>`cecelia-script-${r.identity.reservation_id}-g${r.identity.launch_generation}`;
function labels(r){return {...Object.fromEntries(Object.entries(r.identity).map(([k,v])=>['cecelia.script.'+k,String(v)])),
 'cecelia.script.profile_digest':hash(r.profile)};}
function verify(value,r,id) {
 const p=r.profile,h=value?.HostConfig;
 if(value?.Id!==id||value.Name!=='/'+containerName(r)||value.Image!==r.image_id||value.Config?.Image!==p.image
  ||value.Config?.User!==p.user||value.Config?.WorkingDir!==p.cwd
  ||Object.entries(labels(r)).some(([k,v])=>value.Config?.Labels?.[k]!==v)
  ||!value.State||!['created','running','exited','restarting','paused','dead','removing'].includes(value.State.Status)
  ||h?.CgroupParent!=='cecelia-workloads.slice'||h.Privileged!==false||h.ReadonlyRootfs!==true||h.NetworkMode!=='none'
  ||!equal(value.Mounts,[])||!equal(h.CapDrop,['ALL'])||!equal(h.SecurityOpt,['no-new-privileges'])
  ||['Binds','Devices','DeviceRequests','CapAdd'].some(k=>h[k]!=null&&!equal(h[k],[]))
  ||['PidMode','UTSMode','UsernsMode','IpcMode'].some(k=>h[k]!=null&&!['','private'].includes(h[k]))
  ||h.NanoCpus!==p.cpus*1e9||h.Memory!==p.memoryBytes||h.MemorySwap!==p.memoryBytes||h.PidsLimit!==p.pidsLimit
  ||h.LogConfig?.Type!=='local'||h.LogConfig.Config?.['max-size']!==String(p.logMaxSizeBytes)||h.LogConfig.Config?.['max-file']!==String(p.logMaxFiles))fail();
 return {id:value.Id,name:containerName(r),status:value.State.Status,exit_code:value.State.ExitCode,labels:value.Config.Labels};
}
function createLinuxScriptDockerAdapter({platform=process.platform,getuid=process.getuid,loadRuntime,saveRuntime,assertCanLaunch,run=promisify(execFile)}={}) {
 if(platform!=='linux'||getuid?.()!==0||[loadRuntime,saveRuntime,assertCanLaunch,run].some(fn=>typeof fn!=='function'))fail('adapter_unavailable');
 const options={encoding:'utf8',timeout:10000,maxBuffer:65536,shell:false,env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:'unix:///var/run/docker.sock'}};
 const command=args=>run('/usr/bin/docker',args,options);
 async function load(ref) {
  let r;try{r=validateRuntime(await loadRuntime(ref));}catch{fail();}
  if(ref!==containerName(r)&&ref!==r.container_id)fail();
  return r;
 }
 async function daemon(r) {
  let info;try{info=JSON.parse((await command(['info','--format','{{json .}}'])).stdout);}catch{fail('operation_unconfirmed');}
  if(info.ID!==r.daemon_id||info.CgroupDriver!=='systemd'||info.CgroupVersion!=='2')fail();
 }
 async function inspectRaw(ref) {
  let raw;
  try{raw=(await command(['inspect','--type=container',ref])).stdout;}
  catch(error){if(/^Error(?: response from daemon)?: No such (?:object|container):/m.test(error.stderr??''))return null;fail('operation_unconfirmed');}
  let values;try{values=JSON.parse(raw);}catch{fail('operation_unconfirmed');}
  if(!Array.isArray(values)||values.length!==1)fail('operation_unconfirmed');return values[0];
 }
 async function inspectBound(r) {
  // 已绑定ID永不降级按名称认领；create回执未知时也不自行猜测容器身份。
  if(r.phase==='creating')fail('create_unconfirmed');
  const ref=r.container_id??containerName(r),value=await inspectRaw(ref);
  if(!value)return null;
  if(r.phase!=='bound')fail('create_unconfirmed');
  return verify(value,r,r.container_id);
 }
 return {
  async create(input) {
   const r=await load(input?.name);
   if(!input||!equal(input.profile,r.profile)||typeof input.command!=='string'||!input.command.trim()||Buffer.byteLength(input.command)>8192||input.command.includes('\0')
    ||!input.env||typeof input.env!=='object'||Array.isArray(input.env)||Object.keys(input.env).length>32
    ||Object.entries(input.env).some(([k,v])=>!/^(?:(?:SCRIPT|TASK|APP)_[A-Z0-9_]{1,56}|TZ|LANG|LC_ALL|CI|NODE_ENV|DEBUG)$/.test(k)||typeof v!=='string'||Buffer.byteLength(v)>4096||v.includes('\0'))
    ||!input.identity||Object.entries(input.identity).some(([k,v])=>!IDENTITY.includes(k)||r.identity[k]!==v))fail();
   const job={profile:r.identity.profile_id,cmd:input.command,timeout_sec:r.timeout_sec,env:input.env};
   if(hash(job)!==r.job_digest||hash({job,profile_digest:hash(r.profile)})!==r.identity.config_digest)fail();
   if(r.phase!=='planned')fail('create_unconfirmed');
   await daemon(r);if(await inspectRaw(containerName(r)))fail();
   await assertCanLaunch(r);
   r.phase='creating';await saveRuntime(r); // 创建意图必须先落盘；失败/丢回执保持未决，不重新create。
   await assertCanLaunch(r);
   const p=r.profile,args=['create',`--name=${containerName(r)}`,'--pull=never','--cgroup-parent=cecelia-workloads.slice',
    '--log-driver=local',`--log-opt=max-size=${p.logMaxSizeBytes}`,`--log-opt=max-file=${p.logMaxFiles}`,
    '--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--restart=no',
    `--cpus=${p.cpus}`,`--memory=${p.memoryBytes}`,`--memory-swap=${p.memoryBytes}`,`--pids-limit=${p.pidsLimit}`,
    `--user=${p.user}`,`--workdir=${p.cwd}`,'--entrypoint=/bin/sh',
    ...Object.entries(labels(r)).map(([k,v])=>`--label=${k}=${v}`),...Object.entries(job.env).map(([k,v])=>`--env=${k}=${v}`),p.image,'-c',job.cmd];
   let id;try{id=(await command(args)).stdout.trim();}catch{fail('operation_unconfirmed');}
   if(!ID.test(id))fail('operation_unconfirmed');
   const value=await inspectRaw(id);verify(value,r,id);
   r.container_id=id;r.phase='bound';await saveRuntime(r);
   return id;
  },
  async inspect(ref) {const r=await load(ref);await daemon(r);return inspectBound(r);},
  async start(id) {
   const r=await load(id);if(!ID.test(id)||r.container_id!==id)fail();await daemon(r);
   const current=await inspectBound(r);if(!current)fail('container_absent');
   if(current.status==='running')return;
   if(current.status!=='created')fail('start_refused');
   await assertCanLaunch(r);
   try{await command(['start',id]);}catch{fail('operation_unconfirmed');}
  },
  async remove(id) {
   const r=await load(id);if(!ID.test(id)||r.container_id!==id)fail();await daemon(r);
   if(!await inspectBound(r))return;
   try{await command(['rm','--force',id]);}catch{fail('operation_unconfirmed');}
   if(await inspectRaw(id))fail('cleanup_unconfirmed');
  },
  async logs(id) {
   const r=await load(id);if(!ID.test(id)||r.container_id!==id)fail();await daemon(r);
   if(!await inspectBound(r))fail('container_absent');
   try{const result=await command(['logs','--tail=1000',id]);return {stdout:result.stdout??'',stderr:result.stderr??''};}
   catch{return {stdout:'',stderr:'script_logs_unavailable',logs_unavailable:true};}
  },
 };
}
module.exports={createLinuxScriptDockerAdapter};
