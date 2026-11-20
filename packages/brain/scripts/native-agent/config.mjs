import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {prepareCodexAuth,codexAuthEnvironment} from '../coding-workflow/lib/codex-auth.mjs';
import {computeBundleDigest,sha256} from './bundle.mjs';
import {protectedRead,privateDir,digest,commonKeys} from './store.mjs';
export const brainRoot=path.resolve(import.meta.dirname,'../..');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const profileKeys=['tenant','department','role','account_ref','codex_home','auth_mode','auth_identity_sha256','codex_config_sha256','codex_config_present','home','command','command_sha256','cwd','models','model_aliases','thinking','timeout_ms','terminate_grace_ms','skill_roots','skills'];
function configShape(c){
 if(!plain(c)||Object.keys(c).some(k=>!['protocol','bundle_sha256','state_dir','profiles'].includes(k))||!Array.isArray(c.profiles))throw Error('native_agent_config_invalid');
 for(const p of c.profiles){
  if(!plain(p)||!hex.test(p.codex_config_sha256||'')||typeof p.codex_config_present!=='boolean'||Object.keys(p).some(k=>!profileKeys.includes(k))||['tenant','department','role','account_ref'].some(k=>typeof p[k]!=='string'||!p[k])||!['models','thinking','skill_roots'].every(k=>Array.isArray(p[k])&&p[k].every(v=>typeof v==='string'&&v))||!plain(p.model_aliases)||Object.values(p.model_aliases).some(v=>typeof v!=='string'||!v)||!plain(p.skills)||!Number.isSafeInteger(p.timeout_ms)||p.timeout_ms<=0||(p.terminate_grace_ms!==undefined&&(!Number.isSafeInteger(p.terminate_grace_ms)||p.terminate_grace_ms<1||p.terminate_grace_ms>30000)))throw Error('native_agent_profile_config_invalid');
  for(const skill of Object.values(p.skills))if(!plain(skill)||Object.keys(skill).some(k=>!['path','sha256'].includes(k))||typeof skill.path!=='string'||!hex.test(skill.sha256||''))throw Error('native_agent_profile_config_invalid');
 }
}
export function context(file,expected){
 if(!path.isAbsolute(file)||!hex.test(expected||''))throw Error('native_agent_trusted_transport_required');
 const config=protectedRead(file),bundle=computeBundleDigest(brainRoot);configShape(config);
 if(config.protocol!=='native-agent-config/v1'||config.bundle_sha256!==expected||bundle!==expected)throw Error('native_agent_bundle_mismatch');
 if(!path.isAbsolute(config.state_dir||'')||!Array.isArray(config.profiles))throw Error('native_agent_config_invalid');
 privateDir(config.state_dir,true);
 return {file,config,bundle,config_digest:digest(config)};
}
export function validateInput(r){
 const start=r?.action==='start';const allowed=['protocol','action',...commonKeys,...(start?['prompt','model','thinking','skill_ids','timeout_ms','deadline_ms']:[])];
 if(!r||r.protocol!=='native-agent/v1'||!['start','inspect','cancel'].includes(r.action)||Object.keys(r).some(k=>!allowed.includes(k))||commonKeys.some(k=>typeof r[k]!=='string'||!r[k]))throw Error('native_agent_request_invalid');
 if(![r.task_id,r.run_id,r.request_nonce].every(x=>uuid.test(x))||!hex.test(r.input_digest))throw Error('native_agent_request_invalid');
 if(start&&(typeof r.prompt!=='string'||sha256(r.prompt)!==r.input_digest||r.prompt.length>8*1024*1024||!Array.isArray(r.skill_ids)||new Set(r.skill_ids).size!==r.skill_ids.length||r.skill_ids.some(x=>typeof x!=='string'||!x)))throw Error('native_agent_input_digest_or_skills_invalid');
}
function codexConfigFor(p){
 const file=path.join(p.codex_home,'config.toml');let stat;
 try{stat=fs.lstatSync(file);}catch(e){if(e.code!=='ENOENT')throw Error('native_agent_codex_config_mismatch');}
 const present=stat!==undefined;
 if(present!==p.codex_config_present||present&&(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.nlink!==1||(stat.mode&0o022)))throw Error('native_agent_codex_config_mismatch');
 const hash=sha256(present?fs.readFileSync(file):'');if(hash!==p.codex_config_sha256)throw Error('native_agent_codex_config_mismatch');
 return {codex_config_sha256:hash,codex_config_present:present};
}
export function authFor(p){
 const prepared=prepareCodexAuth({mode:p.auth_mode,home:p.codex_home},{codex:{args:[],env_keys:[]}});
 const value=protectedRead(path.join(p.codex_home,'auth.json'));
 const principal=p.auth_mode==='api-only'?value.OPENAI_API_KEY:value.tokens?.account_id;
 if(typeof principal!=='string'||!principal||!hex.test(p.auth_identity_sha256||'')||sha256(p.auth_mode==='api-only'?principal:'subscription:'+principal)!==p.auth_identity_sha256)throw Error('native_agent_auth_identity_mismatch');
 return prepared;
}
const canonical=p=>fs.existsSync(p)?fs.realpathSync(p):path.resolve(p);
const contains=(a,b)=>a===b||b.startsWith(a+path.sep);
function fixedAuthorityPolicy(ctx,p,auth){
 const authorities=[ctx.config.state_dir,ctx.file,brainRoot,p.command,p.codex_home,path.join(p.home,'.credentials'),path.join(os.userInfo().homedir,'.credentials')].map(canonical);
 const cwd=canonical(p.cwd);
 if(authorities.some(dir=>contains(cwd,dir)||contains(dir,cwd)))throw Error('native_agent_workspace_authority_overlap');
 const policy={commander_activity:{extends:':workspace',filesystem:Object.fromEntries([...new Set(authorities)].map(dir=>[dir,'deny'])),network:{enabled:true}}};
 const toml=x=>x&&typeof x==='object'&&!Array.isArray(x)?'{'+Object.entries(x).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(x);
 const encoded='permissions='+toml(policy);let replaced=0;
 const args=auth.args.map(arg=>arg.startsWith('permissions=')?(replaced++,encoded):arg);
 if(replaced!==1)throw Error('native_agent_workspace_policy_unavailable');
 return {args,permissions_digest:sha256(encoded)};
}
export function profileFor(ctx,r){
 const matches=ctx.config.profiles.filter(p=>['tenant','department','role','account_ref'].every(k=>p[k]===r[k]));
 if(matches.length!==1)throw Error('native_agent_profile_mapping_required');const p=matches[0];
 for(const k of ['home','cwd','command','codex_home'])if(!path.isAbsolute(p[k]||''))throw Error('native_agent_profile_path_invalid');
 const cli_model=p.model_aliases?.[r.model];
 if(typeof cli_model!=='string'||!Array.isArray(p.models)||!Array.isArray(p.thinking)||!p.models.includes(cli_model)||!p.thinking.includes(r.thinking))throw Error('native_agent_model_binding_mismatch');
 if(!Number.isSafeInteger(r.timeout_ms)||r.timeout_ms<=0||r.timeout_ms>p.timeout_ms||!Number.isSafeInteger(r.deadline_ms)||r.deadline_ms<=Date.now()||r.deadline_ms-Date.now()>r.timeout_ms)throw Error('native_agent_deadline_invalid');
 const command=fs.lstatSync(p.command);if(!command.isFile()||command.isSymbolicLink()||sha256(fs.readFileSync(p.command))!==p.command_sha256)throw Error('native_agent_command_drift');
 const skills=r.skill_ids.map(id=>{
  const s=p.skills?.[id];if(!s||!path.isAbsolute(s.path||'')||!Array.isArray(p.skill_roots))throw Error('native_agent_skill_binding_required');
  const actual=fs.realpathSync(s.path);if(actual!==s.path||!p.skill_roots.some(root=>path.isAbsolute(root)&&actual.startsWith(path.resolve(root)+path.sep)))throw Error('native_agent_skill_root_mismatch');
  const bytes=fs.readFileSync(actual);if(sha256(bytes)!==s.sha256)throw Error('native_agent_skill_drift');return {id,sha256:s.sha256,body:bytes.toString('utf8')};
 });
 const codexConfig=codexConfigFor(p);
 const auth=authFor(p);const policy=fixedAuthorityPolicy(ctx,p,auth);auth.args=policy.args;
 const stdin=skills.map(s=>'[Bound Skill '+s.id+' sha256='+s.sha256+']\n'+s.body+'\n').join('')+r.prompt;
 const env=codexAuthEnvironment({HOME:p.home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',LANG:'C.UTF-8',TMPDIR:'/tmp'},auth.auth);
 return {p,auth,env,skills,stdin,cli_model,frozen:{...codexConfig,permissions_digest:policy.permissions_digest,config_digest:ctx.config_digest,profile_digest:digest(p),command_digest:p.command_sha256,skills_digest:digest(skills.map(({id,sha256})=>({id,sha256}))),source_digest:ctx.bundle,stdin_digest:sha256(stdin),auth_identity_sha256:p.auth_identity_sha256}};
}
