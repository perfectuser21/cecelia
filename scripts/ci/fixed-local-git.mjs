/** Bounded local Git reads: a caller's environment and refs/replace are not source authority. */
import {execFileSync} from 'node:child_process';
import {isAbsolute,join} from 'node:path';
import {lstatSync} from 'node:fs';
export function fixedLocalGit(root,args,{encoding,localClone=false,timeoutMs=15000}={}){
 if(localClone&&(!isAbsolute(root)||args.length!==6||args.slice(0,4).join(' ')!=='clone --shared --no-checkout --quiet'||args[4]!==root||!isAbsolute(args[5])))throw Error('INVALID_LOCAL_CLONE');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')&&key!=='SKILLS_SOURCE_SSH_KEY'));
 Object.assign(env,{GIT_NO_REPLACE_OBJECTS:'1',GIT_ALLOW_PROTOCOL:localClone?'file':'',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'});
 return execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','--literal-pathspecs','-C',root,...args],{env,encoding,stdio:['ignore','pipe','pipe'],timeout:Math.max(1,Math.min(15000,timeoutMs)),maxBuffer:32*1024*1024});
}
export function readFixedLocalGitBlob(root,{revision,path},{allowMissing=false,deadline=Infinity}={}){
 if(!/^[0-9a-f]{40}$/.test(revision||'')||typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('INVALID_FIXED_GIT_LOCATION');
 const git=(args,opts={})=>{if(Date.now()>=deadline)throw Error('FIXED_SKILL_BUDGET_EXCEEDED');return fixedLocalGit(root,args,{...opts,timeoutMs:deadline-Date.now()});};
 {
  git(['cat-file','-e',revision+'^{commit}']);
  const tree=git(['ls-tree','-z',revision,'--',path],{encoding:'utf8'});
  if(!tree){
   const parts=path.split('/');
   for(let i=1;i<parts.length;i++){
    const ancestor=git(['ls-tree','-z',revision,'--',parts.slice(0,i).join('/')],{encoding:'utf8'});
    if(ancestor&&!ancestor.startsWith('040000 tree '))throw Error('INVALID_FIXED_GIT_PARENT');
   }
   if(allowMissing)return null;
   throw Error('FIXED_GIT_PATH_MISSING');
  }
  if(!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(tree))throw Error('FIXED_GIT_PATH_NOT_REGULAR_BLOB');
 }
 return git(['show',`${revision}:${path}`]);
}

/** Only the fixed business lock authorizes local central objects; never cache HEAD or generated files. */
export function createFixedLocalSourceReader(root,repo,{readBusinessFile}={}){
 if(!['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(repo))throw Error('FIXED_LOCAL_REPO_UNSUPPORTED');
 const revisions=new Set();
 return (location,options={})=>{
  if(location.repo===repo){
   const bytes=readBusinessFile?readBusinessFile(location,options):readFixedLocalGitBlob(root,location,options);
   const remember=value=>{
    if(location.path==='.skills-source.json'&&value!==null){
     const lock=JSON.parse(Buffer.from(value).toString('utf8'));
     if(lock.version!==1||lock.repository!=='perfectuser21/zenithjoy-skills'||! /^[0-9a-f]{40}$/.test(lock.revision||''))throw Error('FIXED_LOCAL_SKILL_LOCK_INVALID');
     revisions.add(lock.revision);
    }
    return value;
   };
   return bytes?.then?bytes.then(remember):remember(bytes);
  }
  if(location.repo!=='perfectuser21/zenithjoy-skills')throw Error('FIXED_LOCAL_CROSS_REPO_UNAVAILABLE');
  if(!revisions.has(location.revision))throw Error('FIXED_LOCAL_CENTRAL_LOCK_REQUIRED');
  const central=join(root,'.skills-source');
  for(const path of [central,join(central,'.git')]){const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('FIXED_LOCAL_CACHE_SYMLINK');}
  return readFixedLocalGitBlob(central,location,options);
 };
}
export function fixedLocalSourceOptions(root,repo,options={}){
 if(options.readFile)return options;
 const read=createFixedLocalSourceReader(root,repo,options),text=value=>value===null?null:Buffer.from(value).toString('utf8');
 return {...options,readFile:(location,settings)=>{const value=read(location,settings);return value?.then?value.then(text):text(value);}};
}
