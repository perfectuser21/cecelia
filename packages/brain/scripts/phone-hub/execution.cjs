'use strict';
const {randomUUID}=require('node:crypto');
const protocol=require('../phone-ssh/protocol.cjs');
const transport=require('../phone-ssh/transport.cjs');
const {targetValidFull}=require('./capabilities.cjs');
const trusted=new WeakSet(),PHYSICAL=['machine_id','worker_id','physical_boot_id','config_digest','build_digest','action_digest'];
const exact=(v,keys,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
const fresh=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&Date.now()-Date.parse(s)>=-1000&&Date.now()-Date.parse(s)<=5000;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const isExecutionResult=v=>trusted.has(v);
function createExecution({targets,run=transport.runSsh}={}){
 if(!Array.isArray(targets)||!targets.length||targets.length>16||targets.some(t=>!targetValidFull(t))||new Set(targets.map(t=>t.machine_id)).size!==targets.length)throw Error('phone_execution_unconfigured');
 targets=JSON.parse(JSON.stringify(targets));
 return async({operation,identity},{signal,deadline=Date.now()+5000}={})=>{
  if(!['start','inspect','cancel'].includes(operation)||!protocol.identityValid(identity))throw Error('phone_execution_invalid');
  const target=targets.find(t=>t.machine_id===identity.machine_id);
  if(!target||target.worker_id!==identity.worker_id||target.physical_boot_id!==identity.worker_boot_id||target.ssh.host!==identity.host)throw Error('phone_execution_identity_mismatch');
  const physical=Object.fromEntries(PHYSICAL.map(k=>[k,target[k]]));
  const request={schema:'phone-physical-execution/v1',request_nonce:randomUUID(),operation,identity,physical};
  const timeoutMs=Math.min(5000,deadline-Date.now());if(!Number.isInteger(timeoutMs)||timeoutMs<1||signal?.aborted)throw Error('phone_execution_timeout');
  const result=await run('/usr/bin/ssh',transport.sshArgs(target.ssh,transport.RUNNER_COMMAND),JSON.stringify(request),{timeoutMs,maxBytes:16384,signal});
  if(signal?.aborted||Date.now()>deadline||result?.code!==0||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>16384)throw Error('phone_execution_unconfirmed');
  const r=JSON.parse(result.stdout);
  if(!exact(r,['schema','request_nonce','physical','observed_at','identity'])||r.schema!==request.schema||r.request_nonce!==request.request_nonce||!fresh(r.observed_at)||!exact(r.physical,PHYSICAL)||!PHYSICAL.every(k=>r.physical[k]===physical[k])||!exact(r.identity,['dispatch_id',...protocol.BINDINGS,'status'],['execution_exited','lock_released','lock_owner','reason'])||!protocol.receiptValid(identity,r.identity))throw Error('phone_execution_unconfirmed');
  const value=freeze(JSON.parse(JSON.stringify({physical:r.physical,physical_observed_at:r.observed_at,identity:r.identity})));trusted.add(value);return value;
 };
}
module.exports={createExecution,isExecutionResult};
