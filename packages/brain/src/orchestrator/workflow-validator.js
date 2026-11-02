import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callActivityProcess} from './activity-process.js';
const unknown=reason=>({verdict:'unknown',evidence:[],reason});
/** 独立进程只读执行收据；没有标准不猜通过，执行者自述不等于验收。 */
export async function validateWorkflow(profile,receipt,{signal,cancelled=false}={}){
 const validation={workflow:unknown(cancelled?'run_cancelled':'acceptance_missing'),activities:{},cleanup:unknown('cleanup_not_verified')};
 for(const a of profile.contract.activities)validation.activities[a.key]=unknown('activity_acceptance_missing');
 for(const [scope,definition] of Object.entries(profile.validators??{})){
  if(scope!=='workflow'&&scope!=='cleanup'&&!Object.hasOwn(validation.activities,scope))throw Error('workflow_validator_scope_invalid');
  if(cancelled&&scope!=='cleanup')continue;
  const acceptance=definition.acceptance;
  if(!acceptance?.ref)continue;
  if(!['workflow','cleanup'].includes(scope)&&profile.metadata[scope]?.questions?.A4?.ref!==acceptance.ref)continue;
  let verdict,transport;
  const started_at=new Date().toISOString();
  try{
   const bytes=fs.readFileSync(path.resolve(profile.cwd,definition.entry));
   if(createHash('sha256').update(bytes).digest('hex')!==profile.files[definition.entry])throw Error('validator_source_mismatch');
   const activity={budget:{max_duration_s:definition.timeout_s??30,heartbeat_s:5},runtime:{entry:definition.entry,argv:definition.argv??[],cleanup_grace_s:2}};
   transport=await callActivityProcess(activity,{receipt:structuredClone(receipt),acceptance,scope},{cwd:profile.cwd,signal:scope==='cleanup'?undefined:signal});
   const value=JSON.parse(transport.stdout);
   if(transport.reason_code||transport.exit_code!==0||!['pass','fail','unknown'].includes(value.verdict)||value.acceptance_ref!==acceptance.ref||!Array.isArray(value.evidence)||(value.verdict==='pass'&&!value.evidence.length))throw Error('validator_result_invalid');
   verdict={...value,executor:{kind:'code',entry:definition.entry,sha256:profile.files[definition.entry]}};
  }catch{verdict=unknown('validator_unconfirmed');}
  verdict={...verdict,executor:{kind:'code',entry:definition.entry,sha256:profile.files[definition.entry]},started_at,ended_at:new Date().toISOString(),
    transport:transport?{exit_code:transport.exit_code,exit_signal:transport.exit_signal,reason_code:transport.reason_code,duration_s:transport.duration_s}:null};
  if(scope==='workflow')validation.workflow=verdict;else if(scope==='cleanup')validation.cleanup=verdict;else validation.activities[scope]=verdict;
 }
 return validation;
}
