'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const profileDigest=profile=>hash(JSON.stringify(canonical(profile)));
// Complete frozen release/Activity contracts exceed 1 MiB; keep the protected
// catalog bounded independently of untrusted Worker HTTP request limits.
const MAX_WORKFLOW_PROFILES_BYTES=16*1024*1024;
function loadWorkflowProfiles(file){
 if(!file)return {};
 if(!path.isAbsolute(file))throw Error('workflow_profiles_unprotected');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data;
 try{const s=fs.fstatSync(fd);
 if(!s.isFile()||(s.mode&0o077)!==0||![0,process.getuid?.()].includes(s.uid)||s.size>MAX_WORKFLOW_PROFILES_BYTES)throw Error('workflow_profiles_unprotected');
 const bytes=Buffer.alloc(s.size+1);let size=0;
 while(size<bytes.length){const read=fs.readSync(fd,bytes,size,bytes.length-size,null);if(!read)break;size+=read;}
 if(size!==s.size)throw Error('workflow_profiles_unprotected');
 data=JSON.parse(bytes.subarray(0,size).toString('utf8'));}finally{fs.closeSync(fd);}
 if(data.schema_version!==1||!data.profiles||Array.isArray(data.profiles))throw Error('workflow_profiles_invalid');
 return data.profiles;
}
function assertProfile(profile,mode){
 if(!profile||!path.isAbsolute(profile.cwd)||!profile.files||!profile.metadata)throw Error('workflow_profile_invalid');
 if(profile.cleanup_required!==undefined&&typeof profile.cleanup_required!=='boolean')throw Error('workflow_cleanup_obligation_invalid');
 if(profile.cleanup_required===false&&(!Array.isArray(profile.resources)||profile.resources.length!==0||profile.contract?.activities?.some(a=>a.runtime?.phase==='finalize')))throw Error('workflow_cleanup_obligation_invalid');
 const domain=profile.domain_adapter;
 if(domain!==undefined){
  const b=domain?.budget;
  if(!domain||domain.protocol!=='workflow-domain/v1'||typeof domain.entry!=='string'
   ||typeof domain.export_name!=='string'||!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(domain.export_name)
   ||!domain.config||typeof domain.config!=='object'||Array.isArray(domain.config)
   ||!Number.isSafeInteger(b?.max_duration_s)||b.max_duration_s<1||!Number.isSafeInteger(b.cleanup_grace_s)||b.cleanup_grace_s<1
   ||b.max_duration_s+b.cleanup_grace_s>14400)throw Error('workflow_domain_profile_invalid');
 }
 const root=fs.realpathSync(profile.cwd);
 const entries=[...(domain?[domain.entry]:[]),...(profile.contract?.activities??[]).map(a=>a.runtime?.entry),...Object.values(profile.validators??{}).map(v=>v.entry),...Object.values(profile.preconditions??{}).map(v=>v.entry),...Object.values(profile.recoveries??{}).flatMap(v=>[v.entry,v.skill?.entry]),...(profile.commander?[...(profile.commander.kind==='openclaw'?[]:[profile.commander.entry]),profile.commander.skill?.entry]:[]),...Object.values(profile.metadata??{}).filter(m=>m.executor_kind==='agent').map(m=>m.skill?.entry)];
 if(!entries.length||profile.contract.activities.length>100)throw Error('workflow_profile_invalid');
 if(profile.commander){const c=profile.commander,b=c.budget??{};if(c.kind!==undefined&&!['openclaw','process'].includes(c.kind)||!c.skill?.version||c.timeout_s!==undefined&&(!Number.isSafeInteger(c.timeout_s)||c.timeout_s<1||c.timeout_s>300))throw Error('commander_profile_invalid');
  if(b.max_recovery_turns!==undefined&&![0,1].includes(b.max_recovery_turns)||b.max_steers!==undefined&&(!Number.isSafeInteger(b.max_steers)||b.max_steers<0)||b.max_calls!==undefined&&(!Number.isSafeInteger(b.max_calls)||b.max_calls<1)||b.timeout_ms!==undefined&&(!Number.isSafeInteger(b.timeout_ms)||b.timeout_ms<1)||b.max_cost!==undefined&&(!Number.isFinite(b.max_cost)||b.max_cost<0||!Number.isFinite(b.max_call_cost)||b.max_call_cost<=0))throw Error('commander_budget_invalid');}
 for(const v of [...Object.values(profile.validators??{}),...Object.values(profile.preconditions??{}),...Object.values(profile.recoveries??{})]){if(v.timeout_s!==undefined&&(!Number.isSafeInteger(v.timeout_s)||v.timeout_s<1||v.timeout_s>300))throw Error('workflow_validator_budget_invalid');}
 for(const entry of new Set([...entries,...Object.keys(profile.files)])){
  if(typeof entry!=='string'||path.isAbsolute(entry)||entry.split('/').includes('..'))throw Error('workflow_entry_invalid');
  const full=fs.realpathSync(path.join(root,entry));
  if(!full.startsWith(root+path.sep)||hash(fs.readFileSync(full))!==profile.files[entry])throw Error('workflow_source_mismatch');
 }
 for(const activity of profile.contract.activities){
  const meta=profile.metadata[activity.key];
  if(activity.budget?.max_duration_s>(domain?domain.budget.max_duration_s:3600)||activity.budget?.heartbeat_s>activity.budget?.max_duration_s)throw Error('workflow_budget_invalid');
  if(activity.runtime?.recovery_safe===true&&meta?.recovery_safe!==true)throw Error('workflow_recovery_safety_required');
  if((activity.runtime?.max_attempts??1)>1&&meta?.retry_safe!==true)throw Error('workflow_retry_safety_required');
  if(!meta||!['code','agent'].includes(meta.executor_kind)||!UUID.test(meta.activity_id??'')||(meta.executor_kind==='agent'&&!meta.skill?.version))throw Error('workflow_metadata_required');
  if(mode==='formal'){
   const id=meta.identity;
   if(id?.identity_protocol!==2||!['workflow_id','reference_id','workflow_definition_version_id','activity_definition_version_id'].every(k=>UUID.test(id[k]??'')))throw Error('workflow_formal_identity_required');
   if(!profile.preconditions?.[activity.key]?.acceptance?.ref||profile.preconditions[activity.key].acceptance.ref!==meta.questions?.A2?.ref)throw Error('workflow_formal_precondition_required');
   if(!['A1','A2','A3','A4','A5','A6','B1'].every(q=>meta.questions?.[q]?.ref&&meta.questions[q].version&&meta.questions[q].declared!=null)||!profile.validators?.[activity.key])throw Error('workflow_formal_contract_incomplete');
  }
 }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports={loadWorkflowProfiles,assertProfile,profileDigest,UUID};
