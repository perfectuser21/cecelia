import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {fail,copy,canonical,equal,normalizeUsage,summarize,admissionFor} from './commander-usage-ledger-summary.js';
export {normalizeTurns,mergeLedgerSnapshots} from './commander-usage-ledger-summary.js';
const token=/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,255}$/;
const statusValues=['completed','failed','interrupted','cancelled','not_started','unknown','needs_review','passed','blocked'];
const groups={calls:'call_id',attempts:'attempt_id',observations:'observation_id'};
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('usage_ledger_metadata_invalid');}
function validateIdentity(identity){keys(identity,['task_id','run_id']);if(!token.test(identity.task_id??'')||!token.test(identity.run_id??''))fail('usage_ledger_identity_conflict');return copy(identity);}
function policyValue(policy={}){
 keys(policy,['max_total_tokens','max_cost_usd','pricing']);
 for(const k of ['max_total_tokens','max_cost_usd'])if(policy[k]!==undefined&&(!Number.isFinite(policy[k])||policy[k]<0||(k==='max_total_tokens'&&!Number.isSafeInteger(policy[k]))))fail('usage_ledger_policy_invalid');
 if(policy.pricing){
  keys(policy.pricing,['provider','model','version','source','input_per_million','cached_input_per_million','output_per_million']);
  for(const k of ['provider','model','version','source'])if(typeof policy.pricing[k]!=='string'||!policy.pricing[k].trim()||policy.pricing[k].length>2048)fail('usage_ledger_policy_invalid');
  for(const k of ['input_per_million','cached_input_per_million','output_per_million'])if(!Number.isFinite(policy.pricing[k])||policy.pricing[k]<0)fail('usage_ledger_policy_invalid');
 }
 return copy(policy);
}
function safeDirectory(directory){const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)fail('usage_ledger_directory_unprotected');}
function safePath(directory,create=false){
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('usage_ledger_directory_unprotected');
 const resolved=path.resolve(directory),parts=resolved.split(path.sep);let current=path.parse(resolved).root;
 for(const part of parts.filter(Boolean)){current=path.join(current,part);let stat;
  try{stat=fs.lstatSync(current);}catch(e){if(e.code!=='ENOENT'||!create)throw e;fs.mkdirSync(current,{mode:0o700});stat=fs.lstatSync(current);}
  if(!stat.isDirectory()||stat.isSymbolicLink())fail('usage_ledger_directory_unprotected');
 }
 safeDirectory(resolved);return resolved;
}
function safeLinks(fd,file,stat){
 if(stat.nlink===1)return true;
 if(stat.nlink!==2)return false;
 let alias=false;
 for(const name of fs.readdirSync(path.dirname(file)).filter(n=>/^\.[a-f0-9-]{36}\.tmp$/.test(n))){
  try{const other=fs.lstatSync(path.join(path.dirname(file),name));
   if(other.isFile()&&!other.isSymbolicLink()&&other.dev===stat.dev&&other.ino===stat.ino&&other.uid===stat.uid&&(other.mode&0o777)===0o600)alias=true;
  }catch(error){if(error.code!=='ENOENT')throw error;}
 }
 const current=fs.fstatSync(fd);
 return current.nlink===1||(current.nlink===2&&alias);
}
function read(file){
 safeDirectory(path.dirname(file));const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.size>10*1024*1024||!safeLinks(fd,file,s))fail('usage_ledger_file_unprotected');return JSON.parse(fs.readFileSync(fd,'utf8'));}
 finally{fs.closeSync(fd);}
}
function exists(file){try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function durable(file,value){
 safeDirectory(path.dirname(file));const temporary=path.join(path.dirname(file),'.'+randomUUID()+'.tmp');
 const fd=fs.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temporary,file);}finally{fs.unlinkSync(temporary);}
 const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function frozen(value){for(const v of Object.values(value))if(v&&typeof v==='object')frozen(v);return Object.freeze(value);}
function time(value){if(!Number.isSafeInteger(value)||value<0)fail('usage_ledger_time_invalid');return value;}
function metadata(value,group){
 const allowed=group==='calls'?['role','activity_key','action_id','attempt','decision_sequence','provider','model','auth_mode','started_at_ms']
  :group==='attempts'?['activity_key','action_id','attempt','kind','started_at_ms']:['activity_key','action_id','attempt','attempt_id','kind','phase','started_at_ms'];
 keys(value,allowed);const meta=copy(value);delete meta.started_at_ms;
 for(const [k,v] of Object.entries(meta))if(['attempt','decision_sequence'].includes(k)?!Number.isSafeInteger(v)||v<0:typeof v!=='string'||!token.test(v))fail('usage_ledger_metadata_invalid');
 if(group==='calls'&&(!['commander','activity'].includes(meta.role)||!meta.provider||!meta.model))fail('usage_ledger_metadata_invalid');
 if(group==='attempts'&&(!meta.activity_key||!meta.action_id||!Number.isSafeInteger(meta.attempt)||meta.attempt<1||!meta.kind))fail('usage_ledger_metadata_invalid');
 if(group==='observations'&&!meta.kind)fail('usage_ledger_metadata_invalid');
 return meta;
}
function openManifest(directory,identity){
 const root=safePath(directory),manifest=read(path.join(root,'manifest.json'));
 if(manifest.schema_version!==1||!equal(manifest.identity,validateIdentity(identity)))fail('usage_ledger_identity_conflict');
 policyValue(manifest.policy);return {root,manifest};
}
function snapshotAt(root,manifest){
 safePath(root);const out={schema_version:1,identity:copy(manifest.identity),policy:copy(manifest.policy),as_of_ms:Date.now(),admission_lock_present:exists(path.join(root,'.write-lock'))};
 for(const [group,id] of Object.entries(groups)){
  const directory=path.join(root,group);safeDirectory(directory);out[group]=[];
  for(const filename of fs.readdirSync(directory).filter(f=>f.endsWith('.json')&&!f.endsWith('.end.json'))){
   const started=read(path.join(directory,filename));if(!equal(started.identity,manifest.identity)||filename!==started[id]+'.json'||started.group!==group)fail('usage_ledger_identity_conflict');
   const endFile=path.join(directory,started[id]+'.end.json'),end=exists(endFile)?read(endFile):null;
   if(end&&(!equal(end.identity,manifest.identity)||end[id]!==started[id]))fail('usage_ledger_identity_conflict');
   const record={...started.metadata,[id]:started[id],prepared:started,prepared_at_ms:started.prepared_at_ms,started_at_ms:started.started_at_ms,
    status:'prepared',...(group==='calls'?{dispatch_status:'unknown',usage:null}:{}),...(end?{...end.terminal,ended_at_ms:end.ended_at_ms,completion:end.terminal,duration_ms:end.ended_at_ms-started.started_at_ms}:{ended_at_ms:null,duration_ms:null})};
   out[group].push(record);
  }
  out[group].sort((a,b)=>a.prepared_at_ms-b.prepared_at_ms||a[id].localeCompare(b[id]));
 }
 return summarize(out);
}
export function readRunLedger({directory,identity}){const {root,manifest}=openManifest(directory,identity);return snapshotAt(root,manifest);}
export function createRunLedger({directory,identity,policy={}}){
 const ownIdentity=validateIdentity(identity),ownPolicy=policyValue(policy),root=safePath(directory,true),manifestFile=path.join(root,'manifest.json');
 if(!exists(manifestFile)){try{durable(manifestFile,{schema_version:1,identity:ownIdentity,policy:ownPolicy});}catch(e){if(e.code!=='EEXIST')throw e;}}
 const {manifest}=openManifest(root,ownIdentity);if(!equal(manifest.policy,ownPolicy))fail('usage_ledger_policy_conflict');
 for(const group of Object.keys(groups)){const dir=path.join(root,group);try{fs.mkdirSync(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}safeDirectory(dir);}
 const lock=path.join(root,'.write-lock');
 function mutate(fn){
  safePath(root);const owner=randomUUID();
  try{durable(lock,{owner,pid:process.pid,host:os.hostname(),created_at_ms:Date.now()});}catch(e){if(e.code==='EEXIST')fail('usage_ledger_busy');throw e;}
  try{return fn();}
  finally{const value=read(lock);if(value.owner!==owner)fail('usage_ledger_lock_conflict');fs.unlinkSync(lock);}
 }
 const snapshot=()=>snapshotAt(root,manifest);
 function budget(ignoreLock=false){
  const summary=snapshot().summary;return {...admissionFor(summary,ownPolicy,!ignoreLock&&exists(lock)),summary};
 }
 function begin(group,value){const operation=()=>{
  safePath(root);
  const meta=metadata(value,group),id=groups[group],key=group==='attempts'?createHash('sha256').update(canonical({action_id:meta.action_id,attempt:meta.attempt})).digest('hex'):randomUUID();
  const file=path.join(root,group,key+'.json');
  const existing=()=>{const old=read(file);if(value.started_at_ms!==undefined&&time(value.started_at_ms)!==old.started_at_ms)fail('usage_ledger_time_invalid');if(!equal(old.metadata,meta)||!equal(old.identity,ownIdentity))fail('usage_ledger_identity_conflict');return {[id]:key,directory:path.join(root,group,key),started_at_ms:old.started_at_ms};};
  if(exists(file))return existing();
  if(group==='calls'){const check=budget(true);if(!check.allowed)fail(check.reason_code);}
  const started_at_ms=time(value.started_at_ms??Date.now()),record={schema_version:1,group,[id]:key,identity:ownIdentity,metadata:meta,prepared_at_ms:Date.now(),started_at_ms};
  const operationDirectory=path.join(root,group,key);try{fs.mkdirSync(operationDirectory,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}safeDirectory(operationDirectory);
  try{durable(file,record);}catch(error){if(error.code!=='EEXIST')throw error;return existing();}
  return {[id]:key,directory:operationDirectory,started_at_ms};
 };return group==='calls'?mutate(operation):operation();}
 function finish(group,key,value){
  safePath(root);
  if(typeof key!=='string'||!/^[a-f0-9-]{36,64}$/.test(key))fail('usage_ledger_metadata_invalid');
  keys(value,['status','reason_code','evidence_ref','started_at_ms','ended_at_ms',...(group==='calls'?['usage','dispatch_status','cost_usd']:[])]);
  const started=read(path.join(root,group,key+'.json'));if(!equal(started.identity,ownIdentity))fail('usage_ledger_identity_conflict');
  if(!statusValues.includes(value.status))fail('usage_ledger_metadata_invalid');
  for(const k of ['reason_code','evidence_ref'])if(value[k]!==undefined&&(typeof value[k]!=='string'||!value[k].length||value[k].length>2048||(k==='reason_code'&&!token.test(value[k]))))fail('usage_ledger_metadata_invalid');
  if(value.started_at_ms!==undefined&&time(value.started_at_ms)!==started.started_at_ms)fail('usage_ledger_time_invalid');
  const ended_at_ms=time(value.ended_at_ms??Date.now());if(ended_at_ms<started.started_at_ms)fail('usage_ledger_time_invalid');
  const terminal=copy(value);delete terminal.started_at_ms;
  if(group==='calls'){
   terminal.usage=normalizeUsage(value.usage);terminal.dispatch_status=value.dispatch_status??(value.status==='not_started'?'not_started':value.status==='completed'?'dispatched':'unknown');
   if(!['dispatched','not_started','unknown'].includes(terminal.dispatch_status))fail('usage_ledger_metadata_invalid');
   if(terminal.dispatch_status==='not_started'&&(terminal.usage!==null||value.cost_usd!==undefined||value.status==='completed'))fail('usage_ledger_usage_invalid');
   if(value.cost_usd!==undefined&&(!Number.isFinite(value.cost_usd)||value.cost_usd<0||started.metadata.auth_mode==='subscription'))fail('usage_ledger_cost_invalid');
  }
  const file=path.join(root,group,key+'.end.json');
  const existing=()=>{const old=read(file);if(!equal(old.identity,ownIdentity)||old[groups[group]]!==key)fail('usage_ledger_identity_conflict');if(!equal(old.terminal,terminal))fail('usage_ledger_terminal_conflict');return copy(old);};
  if(exists(file))return existing();
  const result={identity:ownIdentity,[groups[group]]:key,terminal,ended_at_ms};
  try{durable(file,result);}catch(error){if(error.code!=='EEXIST')throw error;return existing();}return copy(result);
 }
 return Object.freeze({directory:root,identity:frozen(copy(ownIdentity)),policy:frozen(copy(ownPolicy)),
  beginCall:value=>begin('calls',value),finishCall:(id,value)=>finish('calls',id,value),beginAttempt:value=>begin('attempts',value),finishAttempt:(id,value)=>finish('attempts',id,value),
  beginObservation:value=>begin('observations',value),endObservation:(id,value)=>finish('observations',id,value),snapshot,checkBudget:()=>budget()});
}
