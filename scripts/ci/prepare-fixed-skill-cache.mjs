/** Trusted tooling fetches pinned Git objects only; no candidate loader or Skill is executed. */
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,lstatSync,realpathSync,readFileSync,writeFileSync,chmodSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateImplementationSnapshot} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
const run=promisify(execFile),SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const CENTRAL='perfectuser21/zenithjoy-skills',REMOTE='git@github.com:'+CENTRAL+'.git';
const PROFILES={'perfectuser21/cecelia':'cecelia','perfectuser21/zenithjoy-workspace':'zenithjoy'};
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=b=>createHash('sha256').update(b).digest('hex');
function gitEnvironment(){
 const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('GIT_')||k==='SKILLS_SOURCE_SSH_KEY')delete env[k];
 return {...env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
}
function identity(path){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory())fail('FIXED_SKILL_SOURCE_SYMLINK');return {dev:s.dev,ino:s.ino};}
function sameIdentity(path,before){const now=identity(path);if(now.dev!==before.dev||now.ino!==before.ino)fail('FIXED_SKILL_SOURCE_REPLACED');}
function absent(path){try{lstatSync(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
function repository(root,git){return git(root,['remote','get-url','origin'],{encoding:'utf8'}).trim().replace(/^https:\/\/github\.com\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');}
async function fetchPinned({directory,revision,env,timeoutMs}){
 await run('git',['-c','core.hooksPath=/dev/null','-C',directory,'fetch','--quiet','--no-tags','--no-recurse-submodules','--depth=1',REMOTE,revision],{env,timeout:timeoutMs,maxBuffer:1024*1024});
}
export async function prepareFixedSkillCache({repoRoot,snapshot,cacheBase=tmpdir(),key=process.env.SKILLS_SOURCE_SSH_KEY,deadline=Date.now()+60000,maxVersions=16,fetchCommit=fetchPinned}={}){
 const originalSnapshot=JSON.stringify(snapshot),source=resolve(repoRoot),sourceIdentity=identity(source),root=realpathSync(source);
 const check=()=>{if(Date.now()>=deadline)fail('FIXED_SKILL_BUDGET_EXCEEDED');sameIdentity(source,sourceIdentity);if(realpathSync(source)!==root)fail('FIXED_SKILL_SOURCE_REPLACED');if(JSON.stringify(snapshot)!==originalSnapshot)fail('FIXED_SKILL_SNAPSHOT_CHANGED');};
 if(!Number.isSafeInteger(maxVersions)||maxVersions<1||maxVersions>16||!Number.isSafeInteger(deadline))fail('FIXED_SKILL_BUDGET_INVALID');
 // A caller cannot extend the fixed sixty-second total budget.
 deadline=Math.min(deadline,Date.now()+60000);check();
 const git=(directory,args,options={})=>{check();const value=fixedLocalGit(directory,args,{...options,timeoutMs:deadline-Date.now()});check();return value;};
 const blob=(directory,location,options={})=>{check();const value=readFixedLocalGitBlob(directory,location,{...options,deadline});check();return value;};
 const s=validateImplementationSnapshot(snapshot),repo=s.repo,head=s.revision;
 if(!PROFILES[repo]||s.status!=='verified'||s.gaps?.length||repository(root,git)!==repo||git(root,['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==head)fail('FIXED_SKILL_SOURCE_MISMATCH');
 const destination=join(root,'.skills-source');if(!absent(destination))fail('FIXED_SKILL_CACHE_EXISTS');
 const revisions=new Set([head]),bindings=[];
 for(const row of [...s.definitions.workflows,...s.definitions.activities]){
  if(row.source_repo!==repo||!SHA.test(row.source_commit))fail('FIXED_SKILL_BINDING_SOURCE_INVALID');revisions.add(row.source_commit);
  for(const b of row.payload?.implementation_bindings||[]){
   if(b.kind==='raw'&&b.status==='unresolved')continue;
   if(!['code','skill'].includes(b.kind)||b.repo!==repo||!SHA.test(b.revision))fail('FIXED_SKILL_BINDING_SOURCE_INVALID');
   revisions.add(b.revision);if(b.kind==='skill')bindings.push(b);else if(b.resolved_source!==undefined)fail('FIXED_SKILL_BINDING_SOURCE_INVALID');
  }
 }
 if(revisions.size>maxVersions)fail('FIXED_SKILL_VERSION_LIMIT');
 const locks=new Map(),centralRevisions=new Set();let totalBytes=0;
 const bounded=bytes=>{check();totalBytes+=bytes.length;if(bytes.length>1024*1024||totalBytes>8*1024*1024)fail('FIXED_SKILL_BYTE_LIMIT');return bytes;};
 for(const revision of revisions){
  check();try{git(root,['cat-file','-e',revision+'^{commit}']);}catch(e){check();fail('FIXED_SKILL_BUSINESS_OBJECT_MISSING');}
  const bytes=blob(root,{revision,path:'.skills-source.json'},{allowMissing:true});
  if(bytes===null){locks.set(revision,null);continue;}
  let lock;try{lock=JSON.parse(bounded(bytes));}catch(e){if(e.code)throw e;fail('FIXED_SKILL_LOCK_INVALID');}
  if(Object.keys(lock).sort().join(',')!=='loader_sha256,profile,repository,revision,version'||lock.version!==1||lock.repository!==CENTRAL||lock.profile!==PROFILES[repo]||!SHA.test(lock.revision)||!DIGEST.test(lock.loader_sha256))fail('FIXED_SKILL_LOCK_INVALID');
  locks.set(revision,lock);centralRevisions.add(lock.revision);
 }
 if(revisions.size+centralRevisions.size>maxVersions)fail('FIXED_SKILL_VERSION_LIMIT');
 if(!centralRevisions.size){if(bindings.some(b=>b.resolved_source!==undefined))fail('FIXED_SKILL_BINDING_SOURCE_INVALID');return {status:'not_required',source_repo:repo,source_revision:head,central_revisions:[]};}
 if(typeof key!=='string'||!key.trim())fail('FIXED_SKILL_KEY_REQUIRED');
 let staging,auth;
 try{
  staging=mkdtempSync(join(realpathSync(cacheBase),'fixed-skill-objects-'));auth=mkdtempSync(join(realpathSync(cacheBase),'fixed-skill-auth-'));chmodSync(staging,0o700);chmodSync(auth,0o700);
  const stageIdentity=identity(staging),authIdentity=identity(auth),keyFile=join(auth,'key'),knownHosts=join(auth,'known_hosts');
  writeFileSync(keyFile,key.trimEnd()+'\n',{mode:0o600,flag:'wx'});writeFileSync(knownHosts,'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n',{mode:0o600,flag:'wx'});
  const env=gitEnvironment();env.GIT_ALLOW_PROTOCOL='ssh';env.GIT_SSH_COMMAND=`ssh -F /dev/null -i "${keyFile}" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${knownHosts}"`;
  // No checkout, templates, hooks, submodules, branches or HEAD resolution.
  execFileSync('git',['-c','core.hooksPath=/dev/null','init','--quiet','--template=',staging],{env,timeout:Math.max(1,deadline-Date.now()),stdio:'pipe'});
  const catalogs=new Map();
  for(const revision of centralRevisions){
   check();sameIdentity(staging,stageIdentity);sameIdentity(auth,authIdentity);
   try{await fetchCommit({directory:staging,revision,env,timeoutMs:Math.max(1,deadline-Date.now())});}catch(e){if(Date.now()>=deadline||e.killed)fail('FIXED_SKILL_BUDGET_EXCEEDED');fail('FIXED_SKILL_FETCH_OR_AUTH_FAILED');}
   check();sameIdentity(staging,stageIdentity);
   try{git(staging,['cat-file','-e',revision+'^{commit}']);}catch(e){check();fail('FIXED_SKILL_CENTRAL_OBJECT_MISSING');}
   let catalog;try{catalog=JSON.parse(bounded(blob(staging,{revision,path:'distribution/catalog.json'})));}catch(e){if(e.code)throw e;fail('FIXED_SKILL_CATALOG_INVALID');}
   const files=catalog?.profiles?.[PROFILES[repo]]?.files;if(catalog?.version!==1||!Array.isArray(files)||files.length>10000)fail('FIXED_SKILL_CATALOG_INVALID');catalogs.set(revision,files);
  }
  for(const b of bindings){
   check();const lock=locks.get(b.revision);if(!lock){if(b.resolved_source!==undefined)fail('FIXED_SKILL_BINDING_SOURCE_INVALID');continue;}
   const entries=catalogs.get(lock.revision).filter(e=>e?.path===b.path);if(entries.length!==1||!DIGEST.test(entries[0].sha256||''))fail('FIXED_SKILL_CATALOG_ENTRY_INVALID');
   const resolved={repo:CENTRAL,path:entries[0].source,revision:lock.revision};
   if(b.resolved_source!==undefined&&(Object.keys(b.resolved_source??{}).length!==3||!Object.keys(resolved).every(k=>b.resolved_source[k]===resolved[k])))fail('FIXED_SKILL_BINDING_SOURCE_INVALID');
   const bytes=bounded(blob(staging,resolved));if(digest(bytes)!==entries[0].sha256||b.digest!=='sha256:'+digest(bytes))fail('FIXED_SKILL_DIGEST_MISMATCH');
  }
  check();sameIdentity(staging,stageIdentity);if(!absent(destination))fail('FIXED_SKILL_CACHE_EXISTS');
  const receipt={status:'prepared',source_repo:repo,source_revision:head,snapshot_sha256:s.snapshot_sha256,business_revisions:[...revisions],central_revisions:[...centralRevisions]};
  writeFileSync(join(staging,'fixed-source-cache.json'),JSON.stringify(receipt)+'\n',{mode:0o600,flag:'wx'});
  renameSync(staging,destination);staging=null;sameIdentity(destination,stageIdentity);check();return receipt;
 }finally{if(auth)rmSync(auth,{recursive:true,force:true});if(staging)rmSync(staging,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--repo-root'||args[2]!=='--snapshot')fail('FIXED_SKILL_ARGUMENT_INVALID');const body=JSON.parse(readFileSync(args[3],'utf8'));console.log(JSON.stringify(await prepareFixedSkillCache({repoRoot:args[1],snapshot:body.snapshot||body,cacheBase:process.env.RUNNER_TEMP||tmpdir()})));}
 catch(e){process.stderr.write((/^FIXED_SKILL_[A-Z_]+$/.test(e.code||'')?e.code:'FIXED_SKILL_PREPARATION_FAILED')+'\n');process.exitCode=1;}
}
