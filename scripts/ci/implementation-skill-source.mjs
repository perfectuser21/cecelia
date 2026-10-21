/** Trusted tooling reads pinned skill Git objects; never execute a candidate loader. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readFixedLocalGitBlob,fixedLocalGit} from './fixed-local-git.mjs';
import {validateImplementationSnapshot} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {PATROL_SCOPE,PATROL_REPO,validatePatrolSnapshot,canonical as patrolCanonical} from '../../packages/brain/src/lib/device-patrol-admission.js';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const profileFor={ 'perfectuser21/zenithjoy-workspace':'zenithjoy','perfectuser21/cecelia':'cecelia' };
function environment(){
 const env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')||key==='SKILLS_SOURCE_SSH_KEY')delete env[key];
 return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
}
const git=(root,...args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{env:environment(),maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],timeout:60000});
let cache;
function sourceCache(){
 if(!cache){cache=mkdtempSync(join(tmpdir(),'implementation-skills-'));process.once('exit',()=>rmSync(cache,{recursive:true,force:true}));}
 return join(cache,'objects');
}
function ensureSource(source,revision,{deadline=Date.now()+60000}={}){
 const local=(...args)=>fixedLocalGit(source,args,{deadline});
 try{local('cat-file','-e',`${revision}^{commit}`);return;}catch{}
 mkdirSync(source,{recursive:true});local('-c','core.hooksPath=/dev/null','init','-q','--template=');
 const env=environment();let remote='https://github.com/perfectuser21/zenithjoy-skills.git';
 const key=process.env.SKILLS_SOURCE_SSH_KEY;
 const auth=mkdtempSync(join(tmpdir(),'implementation-skills-auth-'));
 try{
  if(key){
   const identity=join(auth,'key'),hosts=join(auth,'known_hosts');
   writeFileSync(identity,key.trimEnd()+'\n',{mode:0o600});
   writeFileSync(hosts,'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
   env.GIT_SSH_COMMAND=`ssh -F /dev/null -i "${identity}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${hosts}"`;
   remote='git@github.com:perfectuser21/zenithjoy-skills.git';
  }
  const timeout=deadline-Date.now();if(timeout<=0)fail('SKILL_CACHE_TIMEOUT');
  execFileSync('git',['--no-replace-objects','-C',source,'fetch','--quiet','--depth=1',remote,revision],{env,stdio:['ignore','pipe','pipe'],timeout});
 }finally{rmSync(auth,{recursive:true,force:true});}
}
function fixedLock(bytes,repo){
 let lock;try{lock=JSON.parse(bytes);}catch{fail('SKILL_SOURCE_LOCK_INVALID');}
 if(Object.keys(lock??{}).sort().join(',')!=='loader_sha256,profile,repository,revision,version'||lock.version!==1||lock.repository!=='perfectuser21/zenithjoy-skills'||!/^[0-9a-f]{40}$/.test(lock.revision)||!/^[0-9a-f]{64}$/.test(lock.loader_sha256))fail('SKILL_SOURCE_LOCK_INVALID');
 if(lock.profile!==profileFor[repo])fail('SKILL_SOURCE_PROFILE_MISMATCH');return lock;
}
/** CI creates fresh trusted Git objects outside the candidate; it never runs a candidate/central loader. */
export function prepareImplementationSkillCache(root,repo,revisions,{snapshots=[],fetchSource=ensureSource,deadline=Date.now()+60000}={}){
 if(!Object.hasOwn(profileFor,repo)||!Array.isArray(revisions)||!revisions.length||revisions.length>2||revisions.some(r=>!/^[0-9a-f]{40}$/.test(r)))fail('SKILL_CACHE_INPUT_INVALID');
 if(!Number.isSafeInteger(deadline))fail('SKILL_CACHE_INPUT_INVALID');deadline=Math.min(deadline,Date.now()+60000);
 const read=(dir,location,options={})=>readFixedLocalGitBlob(dir,location,{...options,deadline});
 const remote=fixedLocalGit(root,['remote','get-url','origin'],{deadline}).toString().trim().replace(/^https:\/\/github\.com\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');
 if(remote!==repo)fail('SKILL_CACHE_REPO_INVALID');
 if(!Array.isArray(snapshots)||snapshots.length>8)fail('SKILL_CACHE_SNAPSHOT_LIMIT');
 const business=new Set(revisions),bindings=[];let metadata=0,total=0;
 const bounded=bytes=>{total+=bytes.length;if(bytes.length>1024*1024||total>8*1024*1024)fail('SKILL_CACHE_BYTE_LIMIT');return bytes;};
 for(const input of snapshots){
  const size=Buffer.byteLength(JSON.stringify(input));metadata+=size;
  if(size>4*1024*1024||metadata>16*1024*1024)fail('SKILL_CACHE_SNAPSHOT_BYTE_LIMIT');
  if(input?.scope===PATROL_SCOPE&&repo===PATROL_REPO){
   const s=validatePatrolSnapshot(input),{provenance,source}=s.registration;
   const {source_sha256,...sourceBody}=source;
   if(s.repo!==repo||![...revisions,provenance.base_revision].includes(s.revision)||s.registration_sha256!==checksum(JSON.stringify(patrolCanonical(s.registration)))||source_sha256!==checksum(JSON.stringify(patrolCanonical(sourceBody))))fail('SKILL_CACHE_SNAPSHOT_SOURCE_INVALID');
   for(const revision of [s.revision,provenance.base_revision,provenance.introduced_revision])business.add(revision);
   continue;
  }
  const s=validateImplementationSnapshot(input);
  if(s.repo!==repo||!revisions.includes(s.revision)||s.status!=='verified'||s.gaps?.length)fail('SKILL_CACHE_SNAPSHOT_SOURCE_INVALID');
  for(const row of [...s.definitions.workflows,...s.definitions.activities]){
   if(row.source_repo===repo)business.add(row.source_commit);
   for(const b of row.payload?.implementation_bindings||[]){
    if(b.kind==='raw'&&b.status==='unresolved')continue;
    if(!['code','skill'].includes(b.kind)||! /^[0-9a-f]{40}$/.test(b.revision||'')||b.kind==='code'&&b.resolved_source!==undefined)fail('SKILL_CACHE_BINDING_INVALID');
    if(b.repo!==repo){if(b.kind==='skill')fail('SKILL_CACHE_BINDING_REPO_INVALID');continue;}
    business.add(b.revision);if(b.kind==='skill')bindings.push(b);
   }
  }
 }
 if(business.size>16)fail('SKILL_CACHE_VERSION_LIMIT');
 const locks=new Map(),selected=new Set();
 for(const revision of business){
  let bytes;try{bytes=read(root,{revision,path:'.skills-source.json'},{allowMissing:true});}catch{fail('SKILL_CACHE_BUSINESS_OBJECT_OR_LOCK_UNAVAILABLE');}
  const lock=bytes===null?null:fixedLock(bounded(bytes),repo);locks.set(revision,lock);if(lock)selected.add(lock.revision);
 }
 if(business.size+selected.size>16)fail('SKILL_CACHE_VERSION_LIMIT');
 for(const b of bindings){
  const lock=locks.get(b.revision);
  if(b.resolved_source!==undefined&&(!lock||Object.keys(b.resolved_source??{}).sort().join(',')!=='path,repo,revision'||b.resolved_source.repo!==lock.repository||b.resolved_source.revision!==lock.revision))fail('SKILL_CACHE_BINDING_SOURCE_INVALID');
  if(!lock){const bytes=bounded(read(root,{revision:b.revision,path:b.path}));if(b.digest!=='sha256:'+checksum(bytes))fail('SKILL_CACHE_BINDING_DIGEST_INVALID');}
 }
 if(selected.size&&!process.env.SKILLS_SOURCE_SSH_KEY?.trim())fail('SKILL_SOURCE_SSH_KEY_REQUIRED');
 const parent=mkdtempSync(join(process.env.RUNNER_TEMP||tmpdir(),'implementation-skills-ci-')),source=join(parent,'objects');
 try{
  mkdirSync(source,{mode:0o700});const catalogs=new Map();
  for(const revision of selected){
   if(Date.now()>=deadline)fail('SKILL_CACHE_TIMEOUT');fetchSource(source,revision,{deadline});
   const catalog=JSON.parse(bounded(read(source,{revision,path:'distribution/catalog.json'}))),files=catalog?.profiles?.[profileFor[repo]]?.files;
   if(catalog.version!==1||!Array.isArray(files)||files.length>200)fail('SKILL_CACHE_CATALOG_INVALID');catalogs.set(revision,files);
  }
  for(const b of bindings){
   const lock=locks.get(b.revision);if(!lock)continue;
   const matches=catalogs.get(lock.revision).filter(e=>e?.path===b.path);if(matches.length!==1)fail('SKILL_CACHE_BINDING_ENTRY_INVALID');
   const entry=matches[0];if(b.resolved_source!==undefined&&b.resolved_source.path!==entry.source)fail('SKILL_CACHE_BINDING_SOURCE_INVALID');
   const bytes=bounded(read(source,{revision:lock.revision,path:entry.source}));
   if(checksum(bytes)!==entry.sha256||b.digest!=='sha256:'+checksum(bytes))fail('SKILL_CACHE_BINDING_DIGEST_INVALID');
  }
  return source;
 }
 catch(error){rmSync(parent,{recursive:true,force:true});throw error;}
}
/** Materialize catalog bytes only: no candidate code, loader execution, or tracked-file overwrite. */
export function materializeImplementationSkills(root,revision,repo,source,{deadline=Date.now()+60000}={}){
 deadline=Math.min(deadline,Date.now()+60000);const read=(dir,location,options={})=>readFixedLocalGitBlob(dir,location,{...options,deadline});
 const lockBytes=read(root,{revision,path:'.skills-source.json'},{allowMissing:true});
 if(lockBytes===null)return;
 const lock=fixedLock(lockBytes,repo),catalog=JSON.parse(read(source,{revision:lock.revision,path:'distribution/catalog.json'}));
 const files=catalog?.profiles?.[lock.profile]?.files;
 if(catalog.version!==1||!Array.isArray(files)||files.length>200)fail('SKILL_MATERIALIZE_CATALOG_INVALID');
 const regularPath=value=>typeof value==='string'&&value.length<=1000&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p!=='.git');
 const seen=new Set(),pending=[];let total=0;
 for(const file of files){
  if(Date.now()>deadline)fail('SKILL_MATERIALIZE_TIMEOUT');
  if(!file||!regularPath(file.path)||!regularPath(file.source)||!/^[0-9a-f]{64}$/.test(file.sha256)||seen.has(file.path))fail('SKILL_MATERIALIZE_ENTRY_INVALID');
  seen.add(file.path);
  const bytes=read(source,{revision:lock.revision,path:file.source});total+=bytes.length;
  if(bytes.length>1024*1024||total>8*1024*1024||checksum(bytes)!==file.sha256)fail('SKILL_MATERIALIZE_CHECKSUM_INVALID');
  const tracked=read(root,{revision,path:file.path},{allowMissing:true});
  if(tracked!==null){if(!tracked.equals(bytes))fail('SKILL_MATERIALIZE_TRACKED_CONFLICT');continue;}
  const target=join(root,file.path);
  // Check every existing ancestor; never follow a candidate symlink outside its checkout.
  let ancestor=root;
  for(const part of file.path.split('/').slice(0,-1)){
   ancestor=join(ancestor,part);
   try{const stat=lstatSync(ancestor);if(stat.isSymbolicLink()||!stat.isDirectory())fail('SKILL_MATERIALIZE_PARENT_INVALID');}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  try{const stat=lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile()||!readFileSync(target).equals(bytes))fail('SKILL_MATERIALIZE_EXISTING_CONFLICT');}
  catch(error){if(error.code!=='ENOENT')throw error;pending.push({target,bytes});}
 }
 const check=()=>{if(Date.now()>=deadline)fail('SKILL_MATERIALIZE_TIMEOUT');};
 for(const {target,bytes} of pending){check();mkdirSync(dirname(target),{recursive:true});check();writeFileSync(target,bytes,{flag:'wx',mode:0o644});check();}
 check();
}
export function readImplementationSource(root,revision,path,{source}={}){
 if(!/^[0-9a-f]{40}$/.test(revision)||typeof path!=='string'||!path||path.startsWith('/')||path.split('/').some(v=>!v||v==='.'||v==='..')||path.includes('\\'))fail('SKILL_SOURCE_INPUT_INVALID');
 const entry=git(root,'ls-tree','-z',revision,'--',path).toString();
 if(entry){
  if(!/^(100644|100755) blob [0-9a-f]+\t/.test(entry))fail('SKILL_SOURCE_NOT_REGULAR_FILE');
  return git(root,'show',`${revision}:${path}`);
 }
 const remote=git(root,'remote','get-url','origin').toString().trim();
 const repo=remote.replace(/^https:\/\/github\.com\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');
 if(!profileFor[repo])fail('SKILL_SOURCE_REPO_INVALID');
 let lockBytes;try{lockBytes=git(root,'show',`${revision}:.skills-source.json`);}catch{fail('SKILL_SOURCE_LOCK_MISSING');}
 const lock=fixedLock(lockBytes,repo);
 // An explicit CI cache is an offline capability, never permission to fetch again.
 const ciCache=process.env.IMPLEMENTATION_SKILLS_SOURCE_DIR,offline=ciCache!==undefined;
 if(offline&&(!isAbsolute(ciCache)||source&&resolve(source)!==resolve(ciCache)))fail('SKILL_SOURCE_CI_CACHE_INVALID');
 const central=offline?ciCache:source?resolve(source):sourceCache(),deadline=Date.now()+60000;
 if(!offline)ensureSource(central,lock.revision);
 const read=path=>offline?readFixedLocalGitBlob(central,{revision:lock.revision,path},{deadline}):git(central,'show',`${lock.revision}:${path}`);
 const catalog=JSON.parse(read('distribution/catalog.json'));
 const matches=catalog.profiles?.[lock.profile]?.files?.filter(e=>e.path===path);
 if(!matches||matches.length!==1)fail('SKILL_SOURCE_ENTRY_MISSING');
 const selected=matches[0];
 if(typeof selected.source!=='string'||selected.source.startsWith('/')||selected.source.split('/').some(v=>!v||v==='.'||v==='..')||selected.source.includes('\\')||!/^[0-9a-f]{64}$/.test(selected.sha256))fail('SKILL_SOURCE_ENTRY_INVALID');
 const payload=read(selected.source);
 if(checksum(payload)!==selected.sha256)fail('SKILL_SOURCE_CHECKSUM_MISMATCH');
 return payload;
}

if(process.argv[1]&&process.argv[1]!=='-'&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const deadline=Date.now()+60000,[mode,root,repo,...args]=process.argv.slice(2),revisions=[],snapshots=[];let bytes=0;
  if(mode!=='--prepare-ci-cache'||!root)fail('SKILL_CACHE_ARGUMENT_INVALID');
  for(let i=0;i<args.length;i++){
   if(args[i]==='--snapshot'){
    const path=args[++i];if(!path||snapshots.length>=8)fail('SKILL_CACHE_SNAPSHOT_LIMIT');
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024||(bytes+=stat.size)>16*1024*1024)fail('SKILL_CACHE_SNAPSHOT_BYTE_LIMIT');
    snapshots.push(JSON.parse(readFileSync(path,'utf8')));
   }else revisions.push(args[i]);
  }
  const source=prepareImplementationSkillCache(realpathSync(root),repo,revisions,{snapshots,deadline});
  try{materializeImplementationSkills(realpathSync(root),revisions.at(-1),repo,source,{deadline});process.stdout.write(source+'\n');}
  catch(error){rmSync(dirname(source),{recursive:true,force:true});throw error;}
 }catch(error){process.stderr.write((error.code||'SKILL_CACHE_PREPARATION_FAILED')+'\n');process.exitCode=1;}
}
