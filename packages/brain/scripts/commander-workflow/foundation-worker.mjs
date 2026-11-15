#!/usr/bin/env node
// 固定可信Worker入口；任务只带身份和输入，不提供命令、凭据或执行目录。
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareFoundationJob} from './foundation-worker-bundle.mjs';
import {isMainModule} from './runtime-support.mjs';
import {digest} from '../../src/orchestrator/commander-decision.js';
const fail=reason=>{throw Error('foundation_worker_'+reason);};
const reasonCode=error=>/^[A-Za-z0-9_.-]{1,150}$/.test(error?.message??'')?error.message:'foundation_worker_failed';
const READY_REJECTIONS=new Set(['foundation_deadline_exceeded','foundation_definition_changed','foundation_manifest_identity_conflict',
 'foundation_profile_invalid','foundation_profile_digest_mismatch','foundation_profile_paths_invalid','foundation_profile_unbound',
 'foundation_dependency_unbound','foundation_activity_binding_mismatch','foundation_activity_source_unfrozen',
 'foundation_workflow_identity_mismatch','foundation_runtime_revision_invalid','foundation_input_invalid']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function readWorkerConfig(filename){
 if(!path.isAbsolute(filename))fail('config_invalid');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let config;
 try{
  const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.uid!==process.getuid()||stat.size>65536)fail('config_unprotected');
  config=JSON.parse(fs.readFileSync(fd,'utf8'));
 }finally{fs.closeSync(fd);}
 if(!config||config.schema_version!==1||Object.keys(config).some(k=>!['schema_version','brain_url','machine_id','bundle_root','state_root','codex_auth','codex_command','poll_ms'].includes(k))
  ||typeof config.machine_id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(config.machine_id))fail('config_invalid');
 let url;try{url=new URL(config.brain_url);}catch{fail('url_invalid');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))fail('url_invalid');
 for(const key of ['bundle_root','state_root']){
  if(typeof config[key]!=='string'||!path.isAbsolute(config[key]))fail('config_path_invalid');
  fs.mkdirSync(config[key],{recursive:true,mode:0o700});const stat=fs.lstatSync(config[key]);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o022)!==0)fail('config_directory_unprotected');
 }
 if(config.codex_command!==undefined&&(!path.isAbsolute(config.codex_command)||!fs.statSync(config.codex_command).isFile()))fail('config_codex_invalid');
 if(config.poll_ms!==undefined&&(!Number.isSafeInteger(config.poll_ms)||config.poll_ms<1000||config.poll_ms>60000))fail('config_poll_invalid');
 return config;
}
export function createFoundationRequest(config,{env=process.env,fetchFn=globalThis.fetch}={}){
 const token=env.CECELIA_INTERNAL_TOKEN;if(typeof token!=='string'||!token.trim())fail('internal_token_required');
 return async(route,body)=>{
  const response=await fetchFn(new URL('/api/brain/workflow-foundation'+route,config.brain_url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-Internal-Token':token},body:JSON.stringify(body)});
  const bytes=await response.text();if(Buffer.byteLength(bytes)>8*1024*1024)fail('response_oversized');
  let data;try{data=JSON.parse(bytes);}catch{fail('response_invalid');}
  if(!response.ok){const code=typeof data?.error==='string'?data.error:data?.error?.code??data?.code;throw Object.assign(Error(typeof code==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(code)?code:'foundation_worker_api_rejected'),{status:response.status});}
  return data;
 };
}
export async function launchFoundationSupervisor(prepared,{env=process.env}={}){
 if(env.DBOS_DURABLE_ENABLED!=='true'||!env.COMMANDER_DATABASE_URL)fail('database_configuration_required');
 // Brain内部令牌只供此调度客户端，不下传给业务宿主和其子进程。
 const childEnv={...env};delete childEnv.CECELIA_INTERNAL_TOKEN;
 const log=fs.openSync(path.join(prepared.runDirectory,'worker-supervisor.log'),'a',0o600);
 try{
  return await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('./supervise.mjs',import.meta.url)),'--manifest',prepared.manifestPath,'--result',prepared.resultPath],{stdio:['ignore',log,log],env:childEnv});
   child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
  });
 }finally{fs.closeSync(log);}
}
export async function runFoundationWorkerOnce(config,{request=createFoundationRequest(config),launch=launchFoundationSupervisor,taskId}={}){
 if(taskId!==undefined&&!UUID.test(taskId))fail('task_id_invalid');
 const claim=await request('/claim',{machine_id:config.machine_id,...(taskId===undefined?{}:{task_id:taskId})});
 if(!claim||!Object.hasOwn(claim,'job'))fail('claim_invalid');if(claim.job===null)return {status:'idle'};
 const job=claim.job;let prepared,ready;
 const failPreflight=async reason=>{
  const result=await request(`/tasks/${job.task_id}/preflight-failed`,{machine_id:config.machine_id,run_id:job.run_id,reason_code:reason});
  if(!result||result.task_id!==job.task_id||result.run_id!==job.run_id||!['failed','blocked'].includes(result.status))fail('preflight_receipt_invalid');
  return result;
 };
 try{prepared=prepareFoundationJob(job,config);}catch(error){
  return failPreflight(/^[a-z][a-z0-9_]{1,100}$/.test(error.message??'')?error.message:'foundation_worker_preflight_failed');
 }
 try{ready=await request(`/tasks/${job.task_id}/ready`,prepared.readyBody);}catch(error){
  // 仅明确的业务拒绝收账；服务端检查已有授权，决定未启动失败或运行未知blocked。
  if([400,409].includes(error.status)&&READY_REJECTIONS.has(error.message))return failPreflight(error.message);
  throw error;
 }
 if(!ready?.run||digest(ready.run)!==digest(prepared.manifest.run))fail('ready_identity_conflict');
 let error;try{await launch(prepared);}catch(e){error=e;}
 const result=await request(`/tasks/${job.task_id}/reconcile`,{machine_id:config.machine_id,run_id:job.run_id});
 if(!result||result.task_id!==job.task_id||result.run_id!==job.run_id||!['in_progress','completed','failed','blocked'].includes(result.status))fail('reconcile_identity_conflict');
 if(error&&result.status==='in_progress')throw error;
 return result;
}
async function main(){
 const args=process.argv.slice(2),mode=args.includes('--once')?'once':args.includes('--loop')?'loop':null;
 if(!mode||args.includes('--once')&&args.includes('--loop'))fail('usage');
 let filename,taskId;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--once'||args[i]==='--loop')continue;
  if(args[i]==='--config')filename=args[++i];else if(args[i]==='--task-id')taskId=args[++i];else fail('usage');
 }
 if(!filename)fail('usage');const config=readWorkerConfig(filename),request=createFoundationRequest(config);let stopped=false;
 process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
 do{
  try{const result=await runFoundationWorkerOnce(config,{request,taskId});console.log(JSON.stringify({status:result.status,task_id:result.task_id,run_id:result.run_id}));}
  catch(error){console.error(JSON.stringify({error:reasonCode(error)}));if(mode==='once'){process.exitCode=1;return;}}
  if(mode==='once'||stopped)return;await new Promise(resolve=>setTimeout(resolve,config.poll_ms??2000));
 }while(!stopped);
}
if(isMainModule(import.meta.url))main().catch(error=>{console.error(reasonCode(error));process.exitCode=1;});
