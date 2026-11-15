import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadCommanderManifest} from './host.mjs';
import {normalizeCommanderRun,digest,canonical} from '../../src/orchestrator/commander-decision.js';
import {normalizeCodexAuth} from '../coding-workflow/lib/codex-auth.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const REPO=/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const fail=reason=>{throw Error('foundation_worker_'+reason);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const installedBrainRoot=fileURLToPath(new URL('../../',import.meta.url));
export function safeRelative(value){
 if(typeof value!=='string'||!value||value.length>1000||value.includes('\0')||value.includes('\\')||path.isAbsolute(value)||value.split('/').some(x=>!x||x==='.'||x==='..'))fail('path_invalid');
 return value;
}
function within(root,relative,{directory=false}={}){
 safeRelative(relative);let resolved=root;
 for(const item of relative.split('/')){
  resolved=path.join(resolved,item);const stat=fs.lstatSync(resolved);
  if(stat.isSymbolicLink())fail('symlink_rejected');
 }
 const actual=fs.realpathSync(resolved);
 if(!actual.startsWith(root+path.sep)||(directory?!fs.statSync(actual).isDirectory():!fs.statSync(actual).isFile()))fail('path_escape');
 return actual;
}
function sourceBytes(root,relative){
 const filename=within(root,relative);const stat=fs.statSync(filename);
 if(stat.size>1024*1024)fail('source_oversized');
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{return fs.readFileSync(fd);}finally{fs.closeSync(fd);}
}
function immutableFile(filename,bytes){
 const temporary=filename+'.'+randomUUID()+'.tmp';let fd;
 try{
  fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;}
  if(fs.lstatSync(filename).isSymbolicLink()||!fs.readFileSync(filename).equals(Buffer.from(bytes)))fail('immutable_conflict');
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
function ensureDirectory(root,relative){
 safeRelative(relative);let current=root;
 for(const part of relative.split('/')){
  current=path.join(current,part);try{fs.mkdirSync(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o022)!==0||stat.uid!==process.getuid())fail('state_directory_unprotected');
 }
 return current;
}
function rejectTemplateAuthority(value){
 if(!object(value)&&!Array.isArray(value))return;
 for(const [key,item] of Object.entries(value)){
  if(/^(cwd|runtimeRoot|codex_auth|codexHome|codexBin|env|environment|password|token|access_token|api_key|OPENAI_API_KEY|secret|credentials)$/i.test(key))fail('profile_authority_rejected');
  if(key==='command'&&!['@node','@codex'].includes(item))fail('profile_command_rejected');
  rejectTemplateAuthority(item);
 }
}
function injectLocalConfiguration(template,config,cwd){
 const profile={...structuredClone(template),cwd,runtimeRoot:installedBrainRoot};
 if(config.codex_auth!==undefined)profile.codex_auth=normalizeCodexAuth(config.codex_auth);
 if(profile.commander?.provider==='codex'){
  if(!config.codex_command||!profile.codex_auth)fail('codex_configuration_required');
  profile.commander={...profile.commander,codexBin:config.codex_command,codexHome:profile.codex_auth.home,transcriptPath:path.join(cwd,'commander.jsonl')};
 }
 function commands(value){
  if(!object(value)&&!Array.isArray(value))return;
  for(const [key,item] of Object.entries(value)){
   if(key==='command'){
    const file=item==='@node'?process.execPath:config.codex_command;
    if(!file||!path.isAbsolute(file)||!fs.statSync(file).isFile())fail('toolchain_unavailable');
    value.command=fs.realpathSync(file);value.command_sha256=hash(fs.readFileSync(value.command));
   }else commands(item);
  }
 }
 commands(profile.skill_runtime);
 return profile;
}
/** 安装包只提供冻结源码；每run独立工作目录，恢复绝不补写或覆盖已执行目录的源码。 */
export function prepareFoundationJob(job,config){
 if(!object(job)||job.machine_id!==config.machine_id)fail('machine_mismatch');
 if(!UUID.test(job.task_id??'')||!UUID.test(job.run_id??'')||!object(job.input)||job.input.run_tag!==job.run_id)fail('job_identity_invalid');
 canonical(job);
 const ref=job.runtime?.profile_ref;
 if(job.runtime?.kind!=='commander-foundation-v1'||!ref||!REPO.test(ref.repo)||!/^[a-f0-9]{40}$/.test(ref.revision)||!/^sha256:[a-f0-9]{64}$/.test(ref.digest))fail('profile_reference_invalid');
 safeRelative(ref.path);
 const release=job.release.payload,components=release?.components;
 if(!Array.isArray(components))fail('release_invalid');
 const declared=release.workflows?.find(w=>w.id===job.definition?.workflow_definition_version_id&&w.workflow_id===job.definition.workflow_id&&w.payload_sha256===job.definition.snapshot_sha256);
 if(!declared)fail('definition_mismatch');
 const workflowKey=declared.payload.contract?.key??declared.payload.key??declared.payload.contract?.workflow;
 if(job.release.target!==config.machine_id+'/'+workflowKey)fail('machine_mismatch');
 const root=fs.realpathSync(config.bundle_root),installed=within(root,ref.repo+'/'+ref.revision,{directory:true});
 const read=sourceBytes(installed,ref.path),profileDocument=read.toString('utf8');
 const component=(file,sha)=>components.some(c=>['code','skill'].includes(c.kind)&&c.repo===ref.repo&&c.revision===ref.revision&&c.path===file&&c.digest==='sha256:'+sha);
 if(hash(read)!==ref.digest.slice(7)||!component(ref.path,hash(read)))fail('profile_unpublished');
 let document;try{document=JSON.parse(profileDocument);canonical(document);}catch{fail('profile_json_invalid');}
 if(!object(document)||document.schema_version!==1||Object.keys(document).some(k=>!['schema_version','contract','profile'].includes(k))||!object(document.profile)||!object(document.profile.files))fail('profile_invalid');
 rejectTemplateAuthority(document.profile);
 const profile=document.profile,files=Object.entries(profile.files);
 if(files.length<1||files.length>200||!['adapter','codex'].includes(profile.commander?.provider)||!profile.files[profile.adapter])fail('profile_invalid');
 if(!Array.isArray(document.contract?.activities)||document.contract.activities.some(a=>!profile.files[a.runtime?.entry]))fail('activity_unfrozen');
 const keys=document.contract.activities.map(a=>a.key),expected=declared.payload.activities?.map(a=>a.slot_key);
 if(digest(keys)!==digest(expected)||![declared.payload.contract?.key,declared.payload.contract?.workflow,declared.payload.key].includes(document.contract.workflow))fail('contract_mismatch');
 let size=read.length;const verified=new Map();
 for(const [file,sha] of files){
  safeRelative(file);if(!HASH.test(sha)||!component(file,sha))fail('component_unpublished');
  const bytes=sourceBytes(installed,file);size+=bytes.length;
  if(size>8*1024*1024)fail('source_oversized');if(hash(bytes)!==sha)fail('source_drift');verified.set(file,bytes);
 }
 const stateRoot=fs.realpathSync(config.state_root),runDirectory=ensureDirectory(stateRoot,job.run_id),cwd=ensureDirectory(runDirectory,'bundle');
 const manifestPath=path.join(runDirectory,'manifest.json'),existing=fs.existsSync(manifestPath);
 for(const [file,bytes] of verified){
  const name=path.join(cwd,file);if(path.dirname(file)!=='.')ensureDirectory(cwd,path.dirname(file));
  if(existing&&!fs.existsSync(name))fail('workspace_source_missing');
  if(fs.existsSync(name)){if(fs.lstatSync(name).isSymbolicLink()||hash(sourceBytes(cwd,file))!==hash(bytes))fail('workspace_source_drift');}
  else immutableFile(name,bytes);
 }
 const baseRun={schema_version:1,task_id:job.task_id,run_id:job.run_id,contract:document.contract,input:job.input,deadline_ms:job.deadline_ms,commander_timeout_ms:job.runtime.commander_timeout_ms??60000,
  ...(job.cleanup_deadline_ms===undefined?{}:{cleanup_deadline_ms:job.cleanup_deadline_ms})};
 const manifest={run:baseRun,profile:injectLocalConfiguration(profile,config,cwd)};
 const candidate=path.join(runDirectory,randomUUID()+'.preflight.json');
 try{
  fs.writeFileSync(candidate,JSON.stringify(manifest),{flag:'wx',mode:0o600});
  const loaded=loadCommanderManifest(candidate);manifest.run=normalizeCommanderRun(loaded.run);
 }finally{fs.rmSync(candidate,{force:true});}
 immutableFile(manifestPath,JSON.stringify(manifest));
 return {manifest,manifestPath,resultPath:path.join(runDirectory,'result.json'),runDirectory,profileDocument,
  readyBody:{machine_id:config.machine_id,run_id:job.run_id,profile_document:profileDocument,runtime_revision:manifest.run.runtime_revision,definition_sha256:manifest.run.definition_sha256}};
}
