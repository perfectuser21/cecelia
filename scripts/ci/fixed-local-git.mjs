/** Bounded local Git reads: a caller's environment and refs/replace are not source authority. */
import {execFileSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
export function fixedLocalGit(root,args,{encoding,localClone=false}={}){
 if(localClone&&(!isAbsolute(root)||args.length!==6||args.slice(0,4).join(' ')!=='clone --shared --no-checkout --quiet'||args[4]!==root||!isAbsolute(args[5])))throw Error('INVALID_LOCAL_CLONE');
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_NO_REPLACE_OBJECTS:'1',GIT_ALLOW_PROTOCOL:localClone?'file':'',GIT_TERMINAL_PROMPT:'0'});
 return execFileSync('git',['--literal-pathspecs','-C',root,...args],{env,encoding,stdio:['ignore','pipe','pipe'],timeout:15000,maxBuffer:32*1024*1024});
}
export function readFixedLocalGitBlob(root,{revision,path},{allowMissing=false}={}){
 if(!/^[0-9a-f]{40}$/.test(revision||'')||typeof path!=='string'||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('INVALID_FIXED_GIT_LOCATION');
 if(allowMissing){
  fixedLocalGit(root,['cat-file','-e',revision+'^{commit}']);
  const tree=fixedLocalGit(root,['ls-tree','-z',revision,'--',path],{encoding:'utf8'});
  if(!tree){
   const parts=path.split('/');
   for(let i=1;i<parts.length;i++){
    const ancestor=fixedLocalGit(root,['ls-tree','-z',revision,'--',parts.slice(0,i).join('/')],{encoding:'utf8'});
    if(ancestor&&!ancestor.startsWith('040000 tree '))throw Error('INVALID_FIXED_GIT_PARENT');
   }
   return null;
  }
  if(!/^100(?:644|755) blob [0-9a-f]{40}\t/.test(tree))throw Error('FIXED_GIT_PATH_NOT_REGULAR_BLOB');
 }
 return fixedLocalGit(root,['show',`${revision}:${path}`]);
}
