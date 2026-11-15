import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import {digest,normalizeCommanderRun} from '../orchestrator/commander-decision.js';
import {parseActivityContract} from '../orchestrator/activity-contract.js';
export const FOUNDATION_PROTOCOL='commander-foundation-v1';
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{40}$/,HASH=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export const byteHash=x=>createHash('sha256').update(x).digest('hex');
export function foundationError(code,status=409){return Object.assign(new Error(code),{code,status,statusCode:status});}
export function requireFoundation(ok,code,status=409){if(!ok)throw foundationError(code,status);}
export function onlyKeys(value,keys){requireFoundation(object(value)&&Object.keys(value).every(k=>keys.includes(k)),'foundation_input_invalid',400);}
export function relativePath(value){return typeof value==='string'&&value.length>0&&value.length<=500&&!value.includes('\\')&&!value.startsWith('/')&&value.split('/').every(p=>p&&!['.','..'].includes(p));}
export function validateFoundationRuntime(runtime){
 onlyKeys(runtime,['kind','profile_ref','timeout_ms','cleanup_timeout_ms','commander_timeout_ms','input_schema']);
 const ref=runtime.profile_ref;onlyKeys(ref,['repo','path','revision','digest']);
 requireFoundation(runtime.kind===FOUNDATION_PROTOCOL&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ref.repo??'')&&relativePath(ref.path)&&SHA.test(ref.revision??'')&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??''),'foundation_runtime_invalid',400);
 requireFoundation(Number.isSafeInteger(runtime.timeout_ms)&&runtime.timeout_ms>=1000&&runtime.timeout_ms<=86400000,'foundation_timeout_invalid',400);
 if(runtime.cleanup_timeout_ms!==undefined)requireFoundation(Number.isSafeInteger(runtime.cleanup_timeout_ms)&&runtime.cleanup_timeout_ms>0&&runtime.cleanup_timeout_ms<=3600000,'foundation_timeout_invalid',400);
 if(runtime.commander_timeout_ms!==undefined)requireFoundation(Number.isSafeInteger(runtime.commander_timeout_ms)&&runtime.commander_timeout_ms>=100&&runtime.commander_timeout_ms<=600000,'foundation_timeout_invalid',400);
 requireFoundation(object(runtime.input_schema)&&runtime.input_schema.type==='object'&&Buffer.byteLength(JSON.stringify(runtime.input_schema))<=32768,'foundation_input_schema_invalid',400);
 const inspect=(x,depth=0)=>{requireFoundation(depth<30,'foundation_input_schema_invalid',400);if(!object(x)&&!Array.isArray(x))return;for(const [k,v] of Object.entries(x)){requireFoundation(!['$async','$id'].includes(k)&&!(k==='$ref'&&(typeof v!=='string'||!v.startsWith('#/'))),'foundation_input_schema_invalid',400);inspect(v,depth+1);}};inspect(runtime.input_schema);
 try{new Ajv({strict:true,allErrors:false}).compile(runtime.input_schema);}catch{throw foundationError('foundation_input_schema_invalid',400);}
 return runtime;
}
export function validateFoundationInput(runtime,input){
 validateFoundationRuntime(runtime);requireFoundation(object(input)&&!Object.hasOwn(input,'run_tag')&&Buffer.byteLength(JSON.stringify(input))<=262144,'foundation_input_invalid',400);digest(input);
 const validate=new Ajv({strict:true,allErrors:false}).compile(runtime.input_schema);
 requireFoundation(validate(input),'foundation_input_schema_mismatch',400);return input;
}
export function assertProfileComponent(runtime,components){
 const ref=runtime.profile_ref;
 requireFoundation(components.some(c=>c.kind==='code'&&['repo','path','revision','digest'].every(k=>c[k]===ref[k])),'foundation_profile_unbound');
}
export function parseFoundationProfile(text,runtime,release,workflow){
 requireFoundation(typeof text==='string'&&Buffer.byteLength(text)<=1048576,'foundation_profile_invalid',400);
 requireFoundation('sha256:'+byteHash(text)===runtime.profile_ref.digest,'foundation_profile_digest_mismatch');
 let doc;try{doc=JSON.parse(text);}catch{throw foundationError('foundation_profile_invalid',400);}
 onlyKeys(doc,['schema_version','contract','profile']);requireFoundation(doc.schema_version===1&&object(doc.profile),'foundation_profile_invalid',400);
 const p=doc.profile;
 requireFoundation(!['cwd','runtimeRoot','codex_auth','env'].some(k=>Object.hasOwn(p,k))&&object(p.files)&&relativePath(p.adapter)&&HASH.test(p.files[p.adapter]??''),'foundation_profile_invalid',400);
 const rejectAbsolute=(x)=>{if(!object(x)&&!Array.isArray(x))return;for(const [k,v]of Object.entries(x)){requireFoundation(!['cwd','runtimeRoot','codex_auth','env','codexHome','codexBin'].includes(k)&&!(typeof v==='string'&&(v.startsWith('/')||/^[A-Za-z]:[\\/]/.test(v))),'foundation_profile_paths_invalid',400);rejectAbsolute(v);}};rejectAbsolute(p);
 assertProfileComponent(runtime,release.payload.components);
 for(const [file,hash]of Object.entries(p.files))requireFoundation(relativePath(file)&&HASH.test(hash)&&release.payload.components.some(c=>['code','skill'].includes(c.kind)&&c.repo===runtime.profile_ref.repo&&c.revision===runtime.profile_ref.revision&&c.path===file&&c.digest==='sha256:'+hash),'foundation_dependency_unbound');
 const contract=parseActivityContract(doc.contract),keys=workflow.payload.activities.map(a=>a.slot_key);
 requireFoundation(digest(contract.activities.map(a=>a.key))===digest(keys),'foundation_activity_binding_mismatch');
 requireFoundation(contract.activities.every(a=>HASH.test(p.files[a.runtime.entry]??'')),'foundation_activity_source_unfrozen');
 requireFoundation([workflow.payload.contract?.key,workflow.payload.key,workflow.payload.contract?.workflow].includes(contract.workflow),'foundation_workflow_identity_mismatch');
 return {...doc,contract};
}
export function preparedFoundationRun(job,contract,runtimeRevision){
 requireFoundation(HASH.test(runtimeRevision??''),'foundation_runtime_revision_invalid',400);
 return normalizeCommanderRun({schema_version:1,task_id:job.task_id,run_id:job.run_id,contract,input:job.input,runtime_revision:runtimeRevision,deadline_ms:job.deadline_ms,...(job.cleanup_deadline_ms?{cleanup_deadline_ms:job.cleanup_deadline_ms}:{}),commander_timeout_ms:job.runtime.commander_timeout_ms??60000});
}
