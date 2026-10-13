import { it, expect, vi } from 'vitest';
import { checkFence, duplicateEvent, transaction } from '../commander-v2-store.js';
import { digest } from '../commander-v2-contract.js';
it('旧运行、owner和终态均无反馈推进权',()=>{
 const envelope={protocol:'commander-v2',run_id:'run',attempt:2,owner_epoch:2};
 const task={status:'in_progress',result:{workflow_control:{phase:'running',envelope}}};
 expect(checkFence(task,envelope)).toBe(task.result.workflow_control);
 for(const input of [{...envelope,run_id:'old'},{...envelope,owner_epoch:1}])expect(()=>checkFence(task,input)).toThrow('过期反馈');
 expect(()=>checkFence({...task,status:'completed'},envelope)).toThrow('不接收反馈');
});
it('相同序号只能原内容重放，不同摘要拒绝',async()=>{
 const input={run_id:'run',seq:1,data:{text:'中文'}};
 const db={query:vi.fn(async()=>({rows:[{payload:{sha256:digest(input)}}]}))};
 expect(await duplicateEvent(db,'task',input)).toBe(true);
 await expect(duplicateEvent(db,'task',{...input,data:{text:'改了'}})).rejects.toThrow('内容冲突');
});
it('事务工作失败回滚且释放连接，不提交',async()=>{
 const db={query:vi.fn(async sql=>({rows:sql.includes('SELECT * FROM tasks')?[{id:'task'}]:[]})),release:vi.fn()};
 await expect(transaction({connect:async()=>db},'task',async()=>{throw Error('work failed');})).rejects.toThrow('work failed');
 expect(db.query.mock.calls.some(([sql])=>sql==='COMMIT')).toBe(false);expect(db.query).toHaveBeenCalledWith('ROLLBACK');expect(db.release).toHaveBeenCalledTimes(1);
});

import { activityBindings } from '../commander-v2-store.js';
it('活动及步骤映射按冻结UUID关联，不按数组位置或当前定义猜测',()=>{
 const definition={workflow_id:'w',workflow_definition_version_id:'wv',snapshot_sha256:'hash',expected_path:[
  {reference_id:'r2',activity_id:'a2',activity_definition_version_id:'v2'},
  {reference_id:'r1',activity_id:'a1',activity_definition_version_id:'v1',step_id:'s1'},
  {reference_id:'r1',activity_id:'a1',activity_definition_version_id:'v1'}]};
 const release={payload:{workflows:[{id:'wv',workflow_id:'w',payload_sha256:'hash',payload:{activities:[
  {reference_id:'r1',slot_key:'preflight',activity_id:'a1',activity_version_id:'v1'},
  {reference_id:'r2',slot_key:'cleanup',activity_id:'a2',activity_version_id:'v2'}]}}],activities:[
  {id:'v2',activity_id:'a2',payload:{steps:[]}},
  {id:'v1',activity_id:'a1',payload:{steps:[{step_id:'s1',locator:{activity_id:'a1',step_key:'check'}}]}}]}};
 expect(activityBindings(definition,release)).toEqual([
  {key:'cleanup',reference_id:'r2',activity_id:'a2',activity_definition_version_id:'v2',steps:[]},
  {key:'preflight',reference_id:'r1',activity_id:'a1',activity_definition_version_id:'v1',steps:[{key:'check',step_id:'s1'}]}]);
 expect(()=>activityBindings({...definition,expected_path:definition.expected_path.slice(0,1)},release)).toThrow('路径');
 const missing=structuredClone(release);delete missing.payload.workflows[0].payload.activities[0].slot_key;
 expect(()=>activityBindings(definition,missing)).toThrow('key');
});
