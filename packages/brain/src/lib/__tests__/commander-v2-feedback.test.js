import { it, expect, vi } from 'vitest';
import { receiveCommanderEvent } from '../commander-v2-feedback.js';
it('超大数据、未声明协议、非法序号不打开事务',async()=>{
 const pool={connect:vi.fn()};
 const event={protocol:'commander-v2',type:'heartbeat',seq:1,data:{}};
 for(const bad of [{...event,data:{x:'x'.repeat(210000)}},{...event,protocol:'old'},{...event,seq:0},{...event,type:'complete_task'}])await expect(receiveCommanderEvent(pool,'task',bad)).rejects.toThrow();
 expect(pool.connect).not.toHaveBeenCalled();
});
it('错误owner不写事件、不更新控制状态，返回冲突后释放连接',async()=>{
 const e={protocol:'commander-v2',run_id:'run',attempt:1,owner_epoch:2};
 const task={status:'in_progress',result:{workflow_control:{phase:'running',envelope:e}}};
 const db={query:vi.fn(async sql=>({rows:sql.includes('SELECT * FROM tasks')?[task]:[]})),release:vi.fn()};
 await expect(receiveCommanderEvent({connect:async()=>db},'task',{...e,owner_epoch:1,seq:1,type:'heartbeat',data:{}})).rejects.toMatchObject({status:409});
 expect(db.query.mock.calls.some(([sql])=>/^\s*(INSERT|UPDATE)\b/.test(sql))).toBe(false);expect(db.release).toHaveBeenCalledTimes(1);
});
