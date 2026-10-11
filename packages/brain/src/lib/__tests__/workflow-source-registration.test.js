import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { registerWorkflowSource } from '../workflow-source-registration.js';
const id='11111111-1111-4111-8111-111111111111', capability='22222222-2222-4222-8222-222222222222';
const input=()=>({workflow_id:id,capability_id:capability,revision:'a'.repeat(40),actor:'Codex',
 source_repo:'perfectuser21/zenithjoy-workspace',source_capability:'douyin_video_publish',source_path:'product-map/contracts/douyin_video_publish.yaml',source_workflow:'douyin-video-publish',
 expected:{source_repo:null,source_path:null,source_workflow:null,source_capability:null,contract_sync_revision:0}});
const doc=()=>({capability:'android_worker_publish',contract_key:'douyin_video_publish',workflow:'douyin-video-publish',brain_workflow_key:'douyin_video_publish.android',source_repo:'perfectuser21/zenithjoy-workspace',activities:[]});
function fixture(change={}) {
 const row={id,key:'douyin_video_publish.android',capability_id:capability,capability_code:'android_worker_publish',status:'active',...input().expected,...change};
 const client={query:vi.fn(async(sql,args)=>{
  if(sql.startsWith('SELECT'))return {rows:[{...row}]};
  if(sql.startsWith('UPDATE')){Object.assign(row,{source_repo:args[1],source_path:args[2],source_workflow:args[3],source_capability:args[4],contract_sync_revision:1});return {rows:[{...row}]};}
  return {rows:[]};}),release:vi.fn()};
 return {pool:{connect:vi.fn(async()=>client)},client,row};
}
it('固定Git合同身份与CAS旧来源核准后只绑定现有流程，回读返回原身份',async()=>{
 const f=fixture();const receipt=await registerWorkflowSource(f.pool,input(),{readContract:async()=>({document:doc(),sha256:'f'.repeat(64)})});
 expect(receipt).toMatchObject({workflow_id:id,capability_id:capability,source_commit:'a'.repeat(40),readback_verified:true,contract_sync_revision:1});
 expect(f.client.query.mock.calls.filter(([s])=>s.startsWith('UPDATE'))).toHaveLength(1);
 expect(f.client.query.mock.calls.some(([s])=>/INSERT|activities|steps/.test(s))).toBe(false);
});
it.each([{contract_sync_revision:1},{source_repo:'wrong/repo'},{capability_id:'33333333-3333-4333-8333-333333333333'},{capability_code:'wrong'},{capability_code:null},{status:'retired'}])('旧来源/revision/真实能力变化拒绝且回滚',async change=>{
 const f=fixture(change);await expect(registerWorkflowSource(f.pool,input(),{readContract:async()=>({document:doc(),sha256:'f'.repeat(64)})})).rejects.toMatchObject({status:409});
 expect(f.client.query.mock.calls.some(([s])=>s.startsWith('UPDATE'))).toBe(false);expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
});
it.each(['capability','contract_key','workflow','brain_workflow_key','source_repo'])('固定合同%s错误不绑定',async field=>{
 const f=fixture(),d=doc();d[field]='wrong';await expect(registerWorkflowSource(f.pool,input(),{readContract:async()=>({document:d,sha256:'f'.repeat(64)})})).rejects.toBeTruthy();
 expect(f.client.query.mock.calls.some(([s])=>s.startsWith('UPDATE'))).toBe(false);
});
it('缺CAS字段或可变revision在网络和事务前拒绝',async()=>{
 const f=fixture(),readContract=vi.fn();const p=input();delete p.expected.source_path;
 await expect(registerWorkflowSource(f.pool,p,{readContract})).rejects.toMatchObject({status:400});
 await expect(registerWorkflowSource(f.pool,{...input(),revision:'main'},{readContract})).rejects.toMatchObject({status:400});
 expect(readContract).not.toHaveBeenCalled();expect(f.pool.connect).not.toHaveBeenCalled();
});
it('真实Git固定commit/tree/blob字节核验，污染blob在事务前拒绝',async()=>{
 const f=fixture(),bytes=Buffer.from(JSON.stringify(doc())),blobSha=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
 const fetchFn=vi.fn(async url=>({ok:true,json:async()=>url.includes('/git/commits/')?{sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)}}:url.includes('/git/trees/')?{sha:'b'.repeat(40),truncated:false,tree:[{path:input().source_path,type:'blob',mode:'100644',sha:blobSha}]}:{sha:blobSha,encoding:'base64',size:bytes.length,content:bytes.toString('base64')}}));
 expect((await registerWorkflowSource(f.pool,input(),{fetchFn,resolveToken:async()=> 'test-only'})).readback_verified).toBe(true);
 expect(fetchFn.mock.calls.every(([u])=>u.startsWith('https://api.github.com/repos/perfectuser21/zenithjoy-workspace/git/'))).toBe(true);
 const bad=fixture();await expect(registerWorkflowSource(bad.pool,input(),{fetchFn:async u=>{const r=await fetchFn(u);return {ok:true,json:async()=>({...await r.json(),...(u.includes('/git/blobs/')?{content:Buffer.alloc(bytes.length).toString('base64')}:{})})};},resolveToken:async()=> 'test-only'})).rejects.toMatchObject({code:'WORKFLOW_SOURCE_BLOB_MISMATCH'});
 expect(bad.pool.connect).not.toHaveBeenCalled();
});
it('Git树内blob引用必须是固定SHA，路径或查询污染在第三次网络请求前拒绝',async()=>{
 for(const sha of ['../../outside','abc?redirect=https://example.com','https://example.com']){
  const f=fixture();const fetchFn=vi.fn(async url=>({ok:true,json:async()=>String(url).includes('/git/commits/')?{sha:'a'.repeat(40),tree:{sha:'b'.repeat(40)}}:{sha:'b'.repeat(40),truncated:false,tree:[{path:input().source_path,type:'blob',mode:'100644',sha}]}}));
  await expect(registerWorkflowSource(f.pool,input(),{fetchFn,resolveToken:async()=> 'test-only'})).rejects.toMatchObject({code:'WORKFLOW_SOURCE_GIT_REFERENCE_INVALID'});
  expect(fetchFn).toHaveBeenCalledTimes(2);expect(f.pool.connect).not.toHaveBeenCalled();
 }
});
