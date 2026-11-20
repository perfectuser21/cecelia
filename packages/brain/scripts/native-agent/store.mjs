import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import supervisor from '../../src/orchestrator/activity-supervisor-state.cjs';
import {sha256} from './bundle.mjs';
import {groupMembers} from './process.mjs';
export const {protectedRead,protectedText,processBirth,observeProcess}=supervisor;
export const digest=x=>sha256(JSON.stringify(x));
export function privateDir(dir,create=false){
 if(create&&!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o700});
 const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('native_agent_directory_unprotected');
}
export function write(file,value){
 privateDir(path.dirname(file));const tmp=file+'.'+randomUUID();
 fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);
}
export const read=file=>protectedRead(file,2);
export function loadRun(context,runId){
 const dir=path.join(context.config.state_dir,runId);privateDir(dir);
 const request=read(path.join(dir,'request.json'));
 if(request.frozen.source_digest!==context.bundle||request.frozen.config_digest!==context.config_digest)throw Error('native_agent_frozen_source_or_config_drift');
 return {dir,request};
}
export const commonKeys=['tenant','department','role','account_ref','task_id','run_id','request_nonce','input_digest'];
export const common=r=>Object.fromEntries(commonKeys.map(k=>[k,r[k]]));
export function bind(request,input){if(commonKeys.some(k=>request.input[k]!==input[k]))throw Error('native_agent_run_binding_conflict');}
function unknown(s){const {result,termination_scope,...rest}=s;return {...rest,status:'unknown',launch_state:'unknown',execution_stopped:false};}
export function stateOf(run){
 const s=read(path.join(run.dir,'state.json'));
 if(s.request_digest!==digest(run.request))throw Error('native_agent_state_binding_conflict');
 if(s.launch_state==='stopped'){
  if(s.result?.child_exited!==true||!Number.isSafeInteger(s.child?.pid)||typeof s.child.birth!=='string'||observeProcess(s.child.pid,s.child.birth)!=='absent')return unknown(s);
  const group=groupMembers(s.child.pid);if(group===null||group.length)return unknown(s);
  if(s.status==='completed'&&(s.result.exit_code!==0||s.result.signal!==null))return unknown(s);
  return s;
 }
 if(s.launch_state==='not_started'||!s.worker||observeProcess(s.worker.pid,s.worker.birth)!=='matching'||!s.child||observeProcess(s.child.pid,s.child.birth)!=='matching')return unknown(s);
 return s;
}

export function response(run,state){
 const r=run.request;
 return {protocol:'native-agent/v1',...common(r.input),model:r.input.model,actual_cli_model:r.actual_cli_model,thinking:r.input.thinking,skill_ids:r.input.skill_ids,timeout_ms:r.input.timeout_ms,deadline_ms:r.input.deadline_ms,frozen:r.frozen,...state,
 summary:state.status==='completed'?'本次原生会话已退出，业务效果未核验':'原生会话状态：'+state.status,
 evidence:{run_id:r.input.run_id,input_digest:r.input.input_digest,child_exited:state.result?.child_exited===true,termination_scope:state.termination_scope||null,external_effects:'unconfirmed'}};
}
