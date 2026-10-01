'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {createScriptRunner}=require('./script-runner.cjs');
const {createLinuxScriptDockerAdapter}=require('./linux-script-docker.cjs');
const {verifyLinuxScriptPermit}=require('./linux-script-permit.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const IDENTITY=['reservation_id','intent_id','launch_generation','machine_id','owner_key','config_digest','worker_id','worker_boot_id','execution_version_id','execution_grant_id','profile_id'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Error('linux_script_'+code);};
function createLinuxScriptRuntime({stateRoot,key,deployment:input,assertCanLaunch,run,platform=process.platform,getuid=process.getuid,ownerUid=0,pathRoot='/' }={}) {
 if(platform!=='linux'||getuid?.()!==0||typeof stateRoot!=='string'||!path.isAbsolute(stateRoot)
  ||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||typeof assertCanLaunch!=='function')fail('runtime_unavailable');
 const deployment=structuredClone(input),pool=validateLinuxPoolProfile(deployment.pool),context=new AsyncLocalStorage(),runners=new Map();
 if(!pool.execution_budget_available||!deployment.profiles||typeof deployment.profiles!=='object'||Array.isArray(deployment.profiles))fail('runtime_unavailable');
 function directory(filename) {
  let current=filename;
  while(true){const s=fs.lstatSync(current);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==ownerUid||(s.mode&0o022))fail('journal_untrusted');
   if(current===pathRoot)break;const parent=path.dirname(current);if(parent===current)fail('journal_untrusted');current=parent;}
 }
 directory(path.dirname(stateRoot)===pathRoot?pathRoot:stateRoot);
 if(!fs.existsSync(stateRoot))fs.mkdirSync(stateRoot,{mode:0o700});directory(stateRoot);
 const rootStat=fs.lstatSync(stateRoot);
 function rootCheck(){directory(stateRoot);const s=fs.lstatSync(stateRoot);if(s.dev!==rootStat.dev||s.ino!==rootStat.ino||(s.mode&0o777)!==0o700)fail('journal_untrusted');}
 const filename=id=>{if(typeof id!=='string'||!UUID.test(id))fail('identity_mismatch');return path.join(stateRoot,id+'.runtime.json');};
 function read(id) {
  rootCheck();let fd;
  try {
   const file=filename(id);fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const s=fs.fstatSync(fd,{bigint:true});
   if(!s.isFile()||s.uid!==BigInt(ownerUid)||s.nlink!==1n||(s.mode&0o777n)!==0o600n||s.size>32768n)fail('journal_untrusted');
   const buffer=Buffer.alloc(32769),size=fs.readSync(fd,buffer,0,buffer.length,0),after=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(file,{bigint:true});
   if(BigInt(size)!==s.size||s.ctimeNs!==after.ctimeNs||s.ino!==current.ino||s.dev!==current.dev||s.ctimeNs!==current.ctimeNs)fail('journal_untrusted');
   const r=JSON.parse(buffer.subarray(0,size));if(r.identity?.reservation_id!==id)fail('journal_untrusted');return r;
  }catch(error){if(error.code==='ENOENT')return null;fail('journal_untrusted');}finally{if(fd!==undefined)fs.closeSync(fd);}
 }
 function write(r) {
  rootCheck();const file=filename(r.identity.reservation_id),previous=read(r.identity.reservation_id);
  if(previous){const stable=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!['phase','container_id'].includes(k)));
   if(digest(stable(previous))!==digest(stable(r))||previous.container_id&&previous.container_id!==r.container_id
    ||!({planned:['planned','creating'],creating:['creating','bound'],bound:['bound']}[previous.phase]??[]).includes(r.phase))fail('identity_mismatch');}
  const temp=file+'.'+randomUUID(),fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(r));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);const dir=fs.openSync(stateRoot,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }
 function currentExpected(profileId) {
  if(!Object.hasOwn(deployment.profiles,profileId))fail('profile_unavailable');const entry=deployment.profiles[profileId];
  return {machine_registry_id:pool.machine_registry_id,pool_config_digest:pool.config_digest,revision:deployment.revision,
   host_boot_id:deployment.host_boot_id,worker_boot_id:deployment.worker_boot_id,daemon_id:deployment.daemon_id,
   execution_version_id:entry.execution_version_id,execution_grant_id:entry.execution_grant_id,profile_digest:digest(entry.profile)};
 }
 async function launchGate(r) {
  const c=context.getStore();if(!c||c.action!=='start')fail('permit_unverified');
  let expected;try{expected=currentExpected(r.identity.profile_id);}catch{fail('deployment_changed');}
  if(deployment.execution_enabled!==true||digest(expected)!==digest(r.expected)
   ||deployment.profiles[r.identity.profile_id].image_id!==r.image_id)fail('deployment_changed');
  const check=()=>verifyLinuxScriptPermit({key,expected:r.expected,action:'start',body:c.body,permit:c.permit});
  check();await assertCanLaunch(r);check();
 }
 function runner(r) {
  const id=r.identity.reservation_id;if(runners.has(id))return runners.get(id);
  const loadRuntime=async ref=>{const current=read(id);if(!current||![current.container_id,`cecelia-script-${id}-g${current.identity.launch_generation}`].includes(ref))fail('identity_mismatch');return current;};
  const docker=createLinuxScriptDockerAdapter({platform,getuid,loadRuntime,saveRuntime:async value=>write(value),assertCanLaunch:launchGate,run});
  const state=path.join(stateRoot,id);if(!fs.existsSync(state))fs.mkdirSync(state,{mode:0o700});directory(state);
  const value=createScriptRunner({stateRoot:state,machineId:r.identity.machine_id,workerId:r.identity.worker_id,bootId:r.identity.worker_boot_id,
   profiles:{[r.identity.profile_id]:r.profile},docker,assertLocalResources:()=>launchGate(read(id))});
  runners.set(id,value);return value;
 }
 async function operation(action,input) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('identity_mismatch');
  const {permit,...body}=input,id=body.reservation_id;filename(id);rootCheck();
  if(Object.keys(body).some(k=>![...IDENTITY,'job','container_id','challenge','request_nonce'].includes(k)))fail('identity_mismatch');
  const lock=path.join(stateRoot,id+'.gate');
  try{fs.mkdirSync(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('operation_locked');throw error;}
  try {
   let r=read(id);const expected=r?.expected??currentExpected(body.profile_id);
   verifyLinuxScriptPermit({key,expected,action,body,permit});
   if(r){if(IDENTITY.some(k=>r.identity[k]!==body[k]))fail('identity_mismatch');}
   else {
    if(action!=='start'&&action!=='cancel'||action==='start'&&deployment.execution_enabled!==true)fail('intent_unknown');
    const entry=deployment.profiles[body.profile_id],identity=Object.fromEntries(IDENTITY.map(k=>[k,body[k]]));
    if(identity.machine_id!==pool.machine_id||identity.worker_id!==pool.machine_id||identity.worker_boot_id!==deployment.worker_boot_id
     ||identity.execution_version_id!==expected.execution_version_id||identity.execution_grant_id!==expected.execution_grant_id
     ||action==='start'&&(body.job?.profile!==body.profile_id||identity.config_digest!==digest({job:body.job,profile_digest:expected.profile_digest}))
     ||action==='cancel'&&(body.container_id!==null||!UUID.test(body.challenge??'')))fail('identity_mismatch');
    r={identity,profile:entry.profile,job_digest:digest(action==='start'?body.job:null),timeout_sec:action==='start'?body.job.timeout_sec:1,pool:deployment.pool,
     image_id:entry.image_id,daemon_id:deployment.daemon_id,expected,phase:'planned',container_id:null};write(r);
   }
   return await context.run({action,body,permit},async()=>{
    const result=await runner(r)[action](body);
    return {...result,execution_version_id:r.identity.execution_version_id,execution_grant_id:r.identity.execution_grant_id,profile_id:r.identity.profile_id};
   });
  }finally{fs.rmdirSync(lock);}
 }
 // 可信历史journal恢复超时清理，不读取新grant；异常journal阻止服务伪装可用。
 for(const name of fs.readdirSync(stateRoot))if(name.endsWith('.runtime.json')){const id=name.slice(0,-13);runner(read(id));}
 return {start:input=>operation('start',input),inspect:input=>operation('inspect',input),cancel:input=>operation('cancel',input),
  close(){for(const value of runners.values())value.close();runners.clear();}};
}
module.exports={createLinuxScriptRuntime};
