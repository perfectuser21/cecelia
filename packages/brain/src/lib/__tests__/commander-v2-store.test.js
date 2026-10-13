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
