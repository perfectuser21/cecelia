/** 捕获真实future完整树的普通Git数据，不执行其中源码；anchor为已合入受保护main。 */
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixedLocalGit,readFixedLocalGitBlob} from '../../../../../../scripts/ci/fixed-local-git.mjs';
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
 const data=decodeFrozenFutureBytes(),tree=new Set(fixedLocalGit(root,['ls-tree','-rz','--name-only',data.base_revision],{encoding:'utf8'}).split('\0').filter(Boolean)),overlay=new Map(),cache=new Map();
 for(const row of data.delta){
  if(row.mode===null){tree.delete(row.path);overlay.set(row.path,null);continue;}
  tree.add(row.path);overlay.set(row.path,Buffer.from(row.content_base64,'base64'));
 }
 return {data,paths:[...tree].sort(),revision:data.captured_revision,read:async path=>{
  if(!tree.has(path))throw Error('FUTURE_FIXTURE_MISSING');
  if(!cache.has(path))cache.set(path,(overlay.has(path)?overlay.get(path):readFixedLocalGitBlob(root,{revision:data.base_revision,path})).toString('utf8'));
  return cache.get(path);
 }};
}
