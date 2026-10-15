import {describe,it,expect,vi} from 'vitest';
import {setLeadgenRuntimeStatus} from '../leadgen-runtime-status.js';
const id='b1000000-0000-4000-8000-000000000103';
const task='11111111-1111-4111-8111-111111111111';
const body={status:'paused',actor:'codex:/root',task_id:task,reason:'主理人授权的显式暂停'};
describe('四获客正规开闸/暂停',()=>{
 it('未知流程及未登记任务禁止',async()=>{await expect(setLeadgenRuntimeStatus({},'unknown',body)).rejects.toThrow();});
 it('暂停不因部署损坏阻断，事件与读回同事务',async()=>{
  const query=vi.fn(async sql=>{if(sql.includes('FROM tasks'))return {rows:[{id:task,status:'in_progress',payload:{actor:body.actor,workflow_runtime_scope:[id]}}]};if(sql.includes('FROM workflows')||sql.includes('UPDATE workflows'))return {rows:[{id,key:'douyin_comment_scoring',status:query.mock.calls.some(c=>c[0].includes('UPDATE workflows'))?'paused':'active'}]};return {rows:[]};});
  const release=vi.fn(()=>{throw Error('broken')});const releaseClient=vi.fn();
  const result=await setLeadgenRuntimeStatus({connect:async()=>({query,release:releaseClient})},id,body,{getRelease:release});
  expect(result.workflow.status).toBe('paused');expect(release).not.toHaveBeenCalled();expect(query.mock.calls.some(c=>c[0].includes('INSERT INTO task_events'))).toBe(true);expect(query.mock.calls.at(-1)[0]).toBe('COMMIT');
 });
 it('active没有固定release/观测拒绝',async()=>{await expect(setLeadgenRuntimeStatus({},id,{...body,status:'active'})).rejects.toThrow();});
});

describe('正式启用门禁与失败回滚',()=>{
 const releaseId='33333333-3333-4333-8333-333333333333',obs='44444444-4444-4444-8444-444444444444',version='55555555-5555-4555-8555-555555555555',sha='a'.repeat(64),source='b'.repeat(40);
 const active={...body,status:'active',release_id:releaseId,observation_id:obs,workflow_definition_version_id:version,snapshot_sha256:sha};
 function fixture({gate={},release={},taskOverride={}}={}){
  let status='paused';
  const query=vi.fn(async(sql,args)=>{if(sql.includes('FROM tasks'))return {rows:[{id:task,status:'in_progress',payload:{actor:body.actor,workflow_runtime_scope:[id]},...taskOverride}]};if(sql.includes('UPDATE workflows'))status=args[1];if(sql.includes('FROM workflows')||sql.includes('UPDATE workflows'))return {rows:[{id,key:'douyin_comment_scoring',status,current_definition_version_id:version,source_repo:'perfectuser21/zenithjoy-workspace'}]};return {rows:[]};});
  const db={connect:async()=>({query,release:vi.fn()})};
  const deps={lockReleaseTarget:vi.fn(),getRelease:async()=>({id:releaseId,environment:'production',target:'mmv',payload:{components:[{kind:'repo',repo:'perfectuser21/zenithjoy-workspace',revision:source}],workflows:[{id:version,workflow_id:id,payload_sha256:sha,source_repo:'perfectuser21/zenithjoy-workspace',source_commit:source}]},...release}),getReleaseGate:async()=>({deployed:true,actual_matches:true,gaps:[],current_observation_id:obs,...gate})};
  return {db,deps,query};
 }
 it('完整当前MMV冻结release可正规启用并读回',async()=>{const f=fixture();expect((await setLeadgenRuntimeStatus(f.db,id,active,f.deps)).workflow.status).toBe('active');expect(f.query.mock.calls.at(-1)[0]).toBe('COMMIT');});
 it.each([{gate:{deployed:false}},{gate:{actual_matches:false}},{gate:{gaps:[{code:'drift'}]}},{gate:{current_observation_id:'other'}},{release:{environment:'staging'}},{release:{target:'xian-m4'}},{taskOverride:{status:'queued'}},{taskOverride:{payload:{actor:body.actor,workflow_runtime_scope:[]}}}])('不合规启用拒绝且回滚 %j',async opts=>{const f=fixture(opts);await expect(setLeadgenRuntimeStatus(f.db,id,active,f.deps)).rejects.toThrow();expect(f.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');expect(f.query.mock.calls.some(c=>c[0].includes('UPDATE workflows'))).toBe(false);});
 it('当前definition不在release禁止',async()=>{const f=fixture({release:{payload:{workflows:[],components:[]}}});await expect(setLeadgenRuntimeStatus(f.db,id,active,f.deps)).rejects.toThrow('同源');});
});
