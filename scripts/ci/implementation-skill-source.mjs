/** Trusted tooling reads pinned skill Git objects; never execute a candidate loader. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {join,resolve,dirname} from 'node:path';
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
function ensureSource(source,revision){
 try{git(source,'cat-file','-e',`${revision}^{commit}`);return;}catch{}
 mkdirSync(source,{recursive:true});git(source,'init','-q');
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
  execFileSync('git',['--no-replace-objects','-C',source,'fetch','--quiet','--depth=1',remote,revision],{env,stdio:['ignore','pipe','pipe'],timeout:60000});
 }finally{rmSync(auth,{recursive:true,force:true});}
}
function fixedLock(bytes,repo){
 let lock;try{lock=JSON.parse(bytes);}catch{fail('SKILL_SOURCE_LOCK_INVALID');}
 if(Object.keys(lock??{}).sort().join(',')!=='loader_sha256,profile,repository,revision,version'||lock.version!==1||lock.repository!=='perfectuser21/zenithjoy-skills'||!/^[0-9a-f]{40}$/.test(lock.revision)||!/^[0-9a-f]{64}$/.test(lock.loader_sha256))fail('SKILL_SOURCE_LOCK_INVALID');
 if(lock.profile!==profileFor[repo])fail('SKILL_SOURCE_PROFILE_MISMATCH');return lock;
}
/** CI creates fresh trusted Git objects outside the candidate; it never runs a candidate/central loader. */
export function prepareImplementationSkillCache(root,repo,revisions,{fetchSource=ensureSource}={}){
 if(!Object.hasOwn(profileFor,repo)||!Array.isArray(revisions)||!revisions.length||revisions.length>2||revisions.some(r=>!/^[0-9a-f]{40}$/.test(r)))fail('SKILL_CACHE_INPUT_INVALID');
 const remote=git(root,'remote','get-url','origin').toString().trim().replace(/^https:\/\/github\.com\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');
 if(remote!==repo)fail('SKILL_CACHE_REPO_INVALID');
 const selected=[];
 for(const revision of [...new Set(revisions)]){
  const bytes=readFixedLocalGitBlob(root,{revision,path:'.skills-source.json'},{allowMissing:true});
  if(bytes!==null)selected.push(fixedLock(bytes,repo).revision);
 }
 if(selected.length&&!process.env.SKILLS_SOURCE_SSH_KEY?.trim())fail('SKILL_SOURCE_SSH_KEY_REQUIRED');
 const parent=mkdtempSync(join(process.env.RUNNER_TEMP||tmpdir(),'implementation-skills-ci-')),source=join(parent,'objects');
 try{mkdirSync(source,{mode:0o700});for(const revision of [...new Set(selected)]){fetchSource(source,revision);git(source,'cat-file','-e',revision+'^{commit}');}return source;}
 catch(error){rmSync(parent,{recursive:true,force:true});throw error;}
}
/** Materialize catalog bytes only: no candidate code, loader execution, or tracked-file overwrite. */
export function materializeImplementationSkills(root,revision,repo,source){
 const deadline=Date.now()+60000,read=(dir,location,options={})=>readFixedLocalGitBlob(dir,location,{...options,deadline});
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
 for(const {target,bytes} of pending){mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx',mode:0o644});}
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
 // Production always uses a new private cache outside the candidate checkout.
 const central=source?resolve(source):sourceCache();
 ensureSource(central,lock.revision);
 const catalog=JSON.parse(git(central,'show',`${lock.revision}:distribution/catalog.json`));
 const matches=catalog.profiles?.[lock.profile]?.files?.filter(e=>e.path===path);
 if(!matches||matches.length!==1)fail('SKILL_SOURCE_ENTRY_MISSING');
 const selected=matches[0];
 if(typeof selected.source!=='string'||selected.source.startsWith('/')||selected.source.split('/').some(v=>!v||v==='.'||v==='..')||selected.source.includes('\\')||!/^[0-9a-f]{64}$/.test(selected.sha256))fail('SKILL_SOURCE_ENTRY_INVALID');
 const payload=git(central,'show',`${lock.revision}:${selected.source}`);
 if(checksum(payload)!==selected.sha256)fail('SKILL_SOURCE_CHECKSUM_MISMATCH');
 return payload;
}

if(process.argv[1]&&process.argv[1]!=='-'&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,root,repo,...revisions]=process.argv.slice(2);
  if(mode!=='--prepare-ci-cache'||!root)fail('SKILL_CACHE_ARGUMENT_INVALID');
  const source=prepareImplementationSkillCache(realpathSync(root),repo,revisions);
  try{materializeImplementationSkills(realpathSync(root),revisions.at(-1),repo,source);process.stdout.write(source+'\n');}
  catch(error){rmSync(dirname(source),{recursive:true,force:true});throw error;}
 }catch(error){process.stderr.write((error.code||'SKILL_CACHE_PREPARATION_FAILED')+'\n');process.exitCode=1;}
}
