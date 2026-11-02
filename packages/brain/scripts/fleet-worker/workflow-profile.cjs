'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const profileDigest=profile=>hash(JSON.stringify(canonical(profile)));
function loadWorkflowProfiles(file){
 if(!file)return {};
 if(!path.isAbsolute(file))throw Error('workflow_profiles_unprotected');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let data;
 try{const s=fs.fstatSync(fd);
 if(!s.isFile()||(s.mode&0o077)!==0||![0,process.getuid?.()].includes(s.uid)||s.size>1048576)throw Error('workflow_profiles_unprotected');
 data=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
 if(data.schema_version!==1||!data.profiles||Array.isArray(data.profiles))throw Error('workflow_profiles_invalid');
 return data.profiles;
}
function assertProfile(profile,mode){
 if(!profile||!path.isAbsolute(profile.cwd)||!profile.files||!profile.metadata)throw Error('workflow_profile_invalid');
 const root=fs.realpathSync(profile.cwd);
 const entries=[...(profile.contract?.activities??[]).map(a=>a.runtime?.entry),...Object.values(profile.validators??{}).map(v=>v.entry),...Object.values(profile.metadata??{}).filter(m=>m.executor_kind==='agent').map(m=>m.skill?.entry)];
 if(!entries.length||profile.contract.activities.length>100)throw Error('workflow_profile_invalid');
 for(const v of Object.values(profile.validators??{})){if(v.timeout_s!==undefined&&(!Number.isSafeInteger(v.timeout_s)||v.timeout_s<1||v.timeout_s>300))throw Error('workflow_validator_budget_invalid');}
 for(const entry of new Set([...entries,...Object.keys(profile.files)])){
  if(typeof entry!=='string'||path.isAbsolute(entry)||entry.split('/').includes('..'))throw Error('workflow_entry_invalid');
  const full=fs.realpathSync(path.join(root,entry));
  if(!full.startsWith(root+path.sep)||hash(fs.readFileSync(full))!==profile.files[entry])throw Error('workflow_source_mismatch');
 }
 for(const activity of profile.contract.activities){
  const meta=profile.metadata[activity.key];
  if(activity.budget?.max_duration_s>3600||activity.budget?.heartbeat_s>activity.budget?.max_duration_s)throw Error('workflow_budget_invalid');
  if((activity.runtime?.max_attempts??1)>1&&meta?.retry_safe!==true)throw Error('workflow_retry_safety_required');
  if(!meta||!['code','agent'].includes(meta.executor_kind)||!UUID.test(meta.activity_id??'')||(meta.executor_kind==='agent'&&!meta.skill?.version))throw Error('workflow_metadata_required');
  if(mode==='formal'){
   const id=meta.identity;
   if(id?.identity_protocol!==2||!['workflow_id','reference_id','workflow_definition_version_id','activity_definition_version_id'].every(k=>UUID.test(id[k]??'')))throw Error('workflow_formal_identity_required');
   if(!['A1','A2','A3','A4','A5','A6','B1'].every(q=>meta.questions?.[q]?.ref&&meta.questions[q].version&&meta.questions[q].declared!=null)||!profile.validators?.[activity.key])throw Error('workflow_formal_contract_incomplete');
  }
 }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports={loadWorkflowProfiles,assertProfile,profileDigest,UUID};
