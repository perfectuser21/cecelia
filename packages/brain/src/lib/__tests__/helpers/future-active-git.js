/** 捕获真实future完整树的普通Git数据，不执行其中源码；anchor为已合入受保护main。 */
import {readFileSync} from 'node:fs';
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

/** 第二个完整profile只叠固定两份controller普通blob；从不读取工作区实现。 */
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
 if(sha('sha256',bytes)!=='2d5ba8a25cc354b57c7b819846a9d5c4b4bd86f12f32d4223f3e19860d2fb702')throw Error('TYPED_OUTPUT_FIXTURE_DIGEST');
 const data=JSON.parse(gunzipSync(bytes));
 if(data.schema_version!==1||data.extends_fixture_sha256!=='c22090326cbe99e8f345b503c5a98d1ab3b3856211294dfaf5f54028a402ab7d'
  ||data.parent_revision!=='14fce437dcccf1b30daf17423ec48a3ed4337eee'||data.parent_tree!=='f5b015b0a66e798efd666a842364c36579e163f8'
  ||data.captured_revision!=='005a05ce728373f3af4c81c6d8aeca8db1abb3a5'||data.captured_tree!=='92020a92dfed0de39feceacd393915bc634474c4')throw Error('TYPED_OUTPUT_FIXTURE_SOURCE');
 const commit=Buffer.from(data.captured_commit_base64,'base64');
 if(sha('sha1',Buffer.concat([Buffer.from(`commit ${commit.length}\0`),commit]))!==data.captured_revision
  ||!commit.toString().startsWith(`tree ${data.captured_tree}\nparent ${data.parent_revision}\n`))throw Error('TYPED_OUTPUT_FIXTURE_COMMIT');
 const paths=['scripts/ci/implementation-multi-pr-gate.mjs','scripts/ci/implementation-pr-baseline.mjs'];
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
