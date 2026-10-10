import {it,expect} from 'vitest';
import {bootstrapPatrolScope} from '../device-patrol-registration.js';
const base='a'.repeat(40),introduced='b'.repeat(40);

it('GitHub blob正文与tree SHA不符在开写事务前拒绝',async()=>{
 const blobSha='d'.repeat(40),treeSha='c'.repeat(40);let connections=0;
 const pool={connect:async()=>{connections++;throw Error('write must not begin');}};
 const fetchFn=async url=>({ok:true,json:async()=>{
  if(url.includes('/compare/'))return {status:'ahead',merge_base_commit:{sha:base}};
  if(url.includes('/git/commits/'))return {sha:url.split('/').at(-1),tree:{sha:treeSha}};
  if(url.includes('/git/trees/'))return {sha:treeSha,truncated:false,tree: url.includes('unused')?[]:[{path:'scripts/phone-account-patrol/implementation-contract.json',mode:'100644',type:'blob',sha:blobSha}]};
  return {sha:blobSha,encoding:'base64',size:3,content:Buffer.from('bad').toString('base64')};
 }});
 // 两棵树分开，base真正没有该scope路径。
 let treeCalls=0;const transport=async url=>url.includes('/git/trees/')&&++treeCalls===1?{ok:true,json:async()=>({sha:treeSha,truncated:false,tree:[]})}:fetchFn(url);
 await expect(bootstrapPatrolScope(pool,{base_revision:base,introduced_revision:introduced,actor:'operator'},{fetchFn:transport,resolveToken:async()=> 'fixture-not-secret'})).rejects.toThrow('PATROL_GIT_BLOB_MISMATCH');expect(connections).toBe(0);
});
