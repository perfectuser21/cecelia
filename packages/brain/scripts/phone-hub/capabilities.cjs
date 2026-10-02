'use strict';
const {randomUUID}=require('node:crypto');
const {targetValid}=require('../phone-ssh/protocol.cjs');
const transport=require('../phone-ssh/transport.cjs');
const PROBE_COMMAND='/opt/homebrew/bin/python3 /opt/cecelia/phone-ssh/probe.py';
const fields=['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest','ssh'];
function targetValidFull(target){return target&&Object.keys(target).length===fields.length&&fields.every(k=>Object.hasOwn(target,k))&&
 ['machine_id','worker_id','physical_boot_id'].every(k=>typeof target[k]==='string'&&target[k].length>0&&target[k].length<=256)&&
 ['config_digest','build_digest','action_digest'].every(k=>/^[a-f0-9]{64}$/.test(target[k]??''))&&targetValid(target.ssh);}
function observationValid(value,target,nonce){
 const resources=value?.resources;
 const allowed=['schema','request_nonce','machine_id','worker_id','physical_boot_id','config_digest','build_digest','action','action_digest','resources','adb_daemon','external_locks','maintenance','observed_at'];
 const m=value?.maintenance;
 return value&&Object.keys(value).length===allowed.length&&Object.keys(value).every(k=>allowed.includes(k))&&
  m&&['pending','in_flight','activity_revision'].every(k=>Number.isSafeInteger(m[k])&&m[k]>=0)&&['draining','stable','quiescent'].every(k=>typeof m[k]==='boolean')&&
  (!m.quiescent||(m.draining&&m.stable&&m.pending===0&&m.in_flight===0))&&value.schema==='phone-physical-probe/v1'&&value.request_nonce===nonce&&
  ['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'].every(k=>value[k]===target[k])&&value.action==='adb_get_state'&&
  resources&&['cpu_count','memory_total_bytes','data_free_bytes'].every(k=>Number.isSafeInteger(resources[k])&&resources[k]>0)&&
  Number.isSafeInteger(resources.memory_free_bytes)&&resources.memory_free_bytes>=0&&resources.memory_free_bytes<=resources.memory_total_bytes&&
  Number.isFinite(resources.load_1m)&&resources.load_1m>=0&&typeof value.adb_daemon?.reachable==='boolean'&&
  Number.isSafeInteger(value.external_locks?.occupied)&&value.external_locks.occupied>=0&&
  Number.isFinite(Date.parse(value.observed_at))&&Date.now()-Date.parse(value.observed_at)>=-1000&&Date.now()-Date.parse(value.observed_at)<=5000;
}
function createCapabilities({targets,run=transport.runSsh,timeoutMs=5000}){
 if(!Array.isArray(targets)||targets.length===0||targets.some(t=>!targetValidFull(t))||new Set(targets.map(t=>t.machine_id)).size!==targets.length||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw Error('phone_target_unconfigured');
 // 脱离调用者可变对象，目录/安装manifest是唯一目标来源。
 targets=JSON.parse(JSON.stringify(targets));
 return async machineId=>{
  const target=targets.find(t=>t.machine_id===machineId);if(!target)throw Error('phone_target_unconfigured');
  const request={schema:'phone-physical-probe/v1',request_nonce:randomUUID()};
  const args=transport.sshArgs(target.ssh,transport.RUNNER_COMMAND);args[args.length-1]=PROBE_COMMAND;
  try{
   const result=await run('/usr/bin/ssh',args,JSON.stringify(request),{timeoutMs,maxBytes:16384});
   if(result?.code!==0||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>16384)throw Error('unknown');
   const value=JSON.parse(result.stdout);if(!observationValid(value,target,request.request_nonce))throw Error('unknown');
   return value;
  }catch{throw Error('phone_capabilities_unconfirmed');}
 };
}
module.exports={createCapabilities,targetValidFull,PROBE_COMMAND};
