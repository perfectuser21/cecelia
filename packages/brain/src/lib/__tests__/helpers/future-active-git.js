/** 捕获真实future完整树的普通Git数据，不执行其中源码；anchor为已合入受保护main。 */
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,lstatSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixedLocalGit} from '../../../../../../scripts/ci/fixed-local-git.mjs';
const sha=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
export function readFrozenFutureBytes(require=createRequire(import.meta.url)){
 const target=require.resolve('../../../../../../scripts/ci/__tests__/fixtures/future-active-source.json.gz');
 const extension=Object.getOwnPropertyDescriptor(require.extensions,'.gz'),cache=Object.getOwnPropertyDescriptor(require.cache,target);
 try{
  Object.defineProperty(require.extensions,'.gz',{configurable:true,writable:true,enumerable:true,value:(module,filename)=>{
   if(filename!==target)throw Error('FUTURE_DATA_TARGET');module.exports=readFileSync(filename);
  }});
  delete require.cache[target];return require('../../../../../../scripts/ci/__tests__/fixtures/future-active-source.json.gz');
 }finally{
  if(extension)Object.defineProperty(require.extensions,'.gz',extension);else delete require.extensions['.gz'];
  if(cache)Object.defineProperty(require.cache,target,cache);else delete require.cache[target];
 }
}
export function decodeFrozenFutureBytes(bytes=readFrozenFutureBytes()){
 if(sha('sha256',bytes)!=='c22090326cbe99e8f345b503c5a98d1ab3b3856211294dfaf5f54028a402ab7d')throw Error('FUTURE_FIXTURE_DIGEST');
 const data=JSON.parse(gunzipSync(bytes));
 if(data.schema_version!==1||data.base_revision!=='35e2a91d971e8dc432d6f36361c65cded5d64ec8')throw Error('FUTURE_FIXTURE_ANCHOR');
 const seen=new Set();
 for(const row of data.delta){
  if(typeof row.path!=='string'||row.path.startsWith('/')||row.path.includes('\\')||row.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(row.path))throw Error('FUTURE_FIXTURE_PATH');
  seen.add(row.path);if(row.mode===null)continue;
  if(!['100644','100755'].includes(row.mode))throw Error('FUTURE_FIXTURE_MODE');
  const content=Buffer.from(row.content_base64,'base64');
  if(sha('sha1',Buffer.concat([Buffer.from(`blob ${content.length}\0`),content]))!==row.blob_sha1)throw Error('FUTURE_FIXTURE_BLOB');
 }
 return data;
}
export function frozenFutureGit(root){
 const data=decodeFrozenFutureBytes(),base=new Map(),overlay=new Map(),cache=new Map();
 // 一次读取固定树的完整mode/type/object清单；后续只读已证普通blob的不可变对象。
 for(const line of fixedLocalGit(root,['ls-tree','-rz','--full-tree',data.base_revision],{encoding:'utf8'}).split('\0').filter(Boolean)){
  const match=/^(\d{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(line);
  if(!match||base.has(match[4]))throw Error('FUTURE_FIXTURE_BASE_TREE');
  base.set(match[4],{mode:match[1],type:match[2],sha1:match[3]});
 }
 const tree=new Set(base.keys());
 for(const row of data.delta){
  if(row.mode===null){tree.delete(row.path);overlay.set(row.path,null);continue;}
  tree.add(row.path);overlay.set(row.path,Buffer.from(row.content_base64,'base64'));
 }
 return {data,paths:[...tree].sort(),revision:data.captured_revision,read:async path=>{
  if(!tree.has(path))throw Error('FUTURE_FIXTURE_MISSING');
  if(!cache.has(path)){
   let bytes=overlay.get(path);
   if(!overlay.has(path)){
    const entry=base.get(path);
    if(entry?.type!=='blob'||!['100644','100755'].includes(entry.mode))throw Error('FUTURE_FIXTURE_BASE_MODE');
    bytes=fixedLocalGit(root,['cat-file','blob',entry.sha1]);
    if(sha('sha1',Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes]))!==entry.sha1)throw Error('FUTURE_FIXTURE_BASE_BLOB');
   }
   cache.set(path,bytes.toString('utf8'));
  }
  return cache.get(path);
 }};
}

/** 完整profile叠四份已审controller/collector普通blob；从不读取工作区实现。 */
export function readFrozenTypedOutputBytes(require=createRequire(import.meta.url)){
 const target=require.resolve('../../../../../../scripts/ci/__tests__/fixtures/future-active-typed-output-v2.json.gz');
 const extension=Object.getOwnPropertyDescriptor(require.extensions,'.gz'),cache=Object.getOwnPropertyDescriptor(require.cache,target);
 try{
  Object.defineProperty(require.extensions,'.gz',{configurable:true,writable:true,enumerable:true,value:(module,filename)=>{
   if(filename!==target)throw Error('TYPED_OUTPUT_DATA_TARGET');module.exports=readFileSync(filename);
  }});delete require.cache[target];return require('../../../../../../scripts/ci/__tests__/fixtures/future-active-typed-output-v2.json.gz');
 }finally{
  if(extension)Object.defineProperty(require.extensions,'.gz',extension);else delete require.extensions['.gz'];
  if(cache)Object.defineProperty(require.cache,target,cache);else delete require.cache[target];
 }
}
export function decodeFrozenTypedOutputBytes(bytes=readFrozenTypedOutputBytes()){
 if(sha('sha256',bytes)!=='7af877c2f2fc289ee3052d9bcf4be686b3ab83c3e2aaf47bad6a90c08a285bd1')throw Error('TYPED_OUTPUT_FIXTURE_DIGEST');
 const data=JSON.parse(gunzipSync(bytes));
 if(data.schema_version!==1||data.extends_fixture_sha256!=='c22090326cbe99e8f345b503c5a98d1ab3b3856211294dfaf5f54028a402ab7d'
  ||data.parent_revision!=='14fce437dcccf1b30daf17423ec48a3ed4337eee'||data.parent_tree!=='f5b015b0a66e798efd666a842364c36579e163f8'
  ||data.captured_revision!=='a1fb24ffbe9c2c58bfe0e5bf6bb44e48456b4270'||data.captured_tree!=='331f228fe36d5b18658f762ef6cd8b3ed61e8e6f')throw Error('TYPED_OUTPUT_FIXTURE_SOURCE');
 const commit=Buffer.from(data.captured_commit_base64,'base64');
 if(sha('sha1',Buffer.concat([Buffer.from(`commit ${commit.length}\0`),commit]))!==data.captured_revision
  ||!commit.toString().startsWith(`tree ${data.captured_tree}\nparent ${data.parent_revision}\n`))throw Error('TYPED_OUTPUT_FIXTURE_COMMIT');
 const paths=['scripts/ci/implementation-multi-pr-gate.mjs','scripts/ci/implementation-pr-baseline.mjs','packages/brain/src/lib/existing-ops-workspace-source.js','packages/brain/src/lib/existing-ops-source.js'];
 if(JSON.stringify(data.members?.map(r=>r.path))!==JSON.stringify(paths))throw Error('TYPED_OUTPUT_FIXTURE_PATH');
 for(const row of data.members){
  if(row.mode!=='100644')throw Error('TYPED_OUTPUT_FIXTURE_MODE');
  const content=Buffer.from(row.content_base64,'base64');
  if(sha('sha256',content)!==row.sha256||sha('sha1',Buffer.concat([Buffer.from(`blob ${content.length}\0`),content]))!==row.blob_sha1)throw Error('TYPED_OUTPUT_FIXTURE_BLOB');
 }
 return data;
}
export function frozenTypedOutputFutureGit(root){
 const base=frozenFutureGit(root),data=decodeFrozenTypedOutputBytes();
 if(base.data.captured_revision!==data.parent_revision||base.data.captured_tree!==data.parent_tree)throw Error('TYPED_OUTPUT_FIXTURE_PARENT');
 const changed=new Map(data.members.map(row=>[row.path,Buffer.from(row.content_base64,'base64').toString('utf8')]));
 if([...changed.keys()].some(path=>!base.paths.includes(path)))throw Error('TYPED_OUTPUT_FIXTURE_PATH');
 return {...base,data:{...base.data,captured_revision:data.captured_revision,captured_tree:data.captured_tree,controller_overlay:data},revision:data.captured_revision,
  read:async path=>changed.has(path)?changed.get(path):base.read(path)};
}

/** 仅显式测试调用：私有Git重建已校验的完整树，不自动导入或执行捕获源码。 */
export function materializeFrozenCollector(root,{historical=false}={}){
 const home=mkdtempSync(join(tmpdir(),'frozen-collector-runtime-')),checkout=join(home,'source');
 const close=()=>rmSync(home,{recursive:true,force:true,maxRetries:3,retryDelay:20});
 try{
  fixedLocalGit(root,['clone','--shared','--no-checkout','--quiet',root,checkout],{localClone:true});
  const git=(...args)=>fixedLocalGit(checkout,['-c','maintenance.auto=false','-c','gc.auto=0',...args],{encoding:'utf8'}).trim();
  const input=historical?frozenFutureGit(root):frozenTypedOutputFutureGit(root);
  if(historical)git('checkout','--quiet','--detach','bc597b839142052c33689750a33472f73bbd89d1');
  else{
   git('checkout','--quiet','--detach',input.data.base_revision);
   const rows=[...input.data.delta,...input.data.controller_overlay.members];
   for(const row of rows){
    const target=join(checkout,row.path);let parent=dirname(target);
    while(parent!==checkout){try{if(lstatSync(parent).isSymbolicLink())throw Error('FROZEN_RUNTIME_PARENT');}catch(error){if(error.code!=='ENOENT')throw error;}parent=dirname(parent);}
    if(row.mode===null){rmSync(target,{recursive:true,force:true});continue;}
    mkdirSync(dirname(target),{recursive:true});
    try{if(lstatSync(target).isSymbolicLink())rmSync(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    writeFileSync(target,Buffer.from(row.content_base64,'base64'));chmodSync(target,row.mode==='100755'?0o755:0o644);
   }
   git('-c','core.filemode=true','add','-A','-f','--',...[...new Set(rows.map(row=>row.path))]);
   if(git('write-tree')!==input.data.captured_tree)throw Error('FROZEN_RUNTIME_TREE');
   const commitFile=join(home,'capture.commit');writeFileSync(commitFile,Buffer.from(input.data.controller_overlay.captured_commit_base64,'base64'));
   if(git('hash-object','-t','commit','-w',commitFile)!==input.revision)throw Error('FROZEN_RUNTIME_COMMIT');
   git('checkout','--quiet','--detach',input.revision);
   if(git('rev-parse','HEAD^{tree}')!==input.data.captured_tree||git('status','--porcelain=v1','--untracked-files=no'))throw Error('FROZEN_RUNTIME_CHECKOUT');
  }
  for(const relative of ['', 'packages/brain'])symlinkSync(join(root,relative,'node_modules'),join(checkout,relative,'node_modules'),'dir');
  return {home,checkout,input,sourceFile:join(checkout,'packages/brain/src/lib/existing-ops-source.js'),workspaceFile:join(checkout,'packages/brain/src/lib/existing-ops-workspace-source.js'),runtimeFile:join(checkout,'packages/brain/src/lib/native-consumer-runtime.js'),git,close};
 }catch(error){close();throw error;}
}
