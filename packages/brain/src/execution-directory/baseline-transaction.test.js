import {it,expect,vi} from 'vitest';
import {baselineTransaction} from './baseline-transaction.js';
it('迟到pool连接只释放，超时响应后不能开始或提交事务',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),client={query:vi.fn(),release:vi.fn()};
 const operation=vi.fn();await expect(baselineTransaction({connect:()=>pending},Date.now()+15,operation)).rejects.toThrow('execution_baseline_deadline');
 resolve(client);await new Promise(r=>setTimeout(r,0));expect(client.release).toHaveBeenCalledOnce();expect(client.query).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();
});
it('COMMIT确认未知不会用ROLLBACK冒充zero，销毁连接并明确需对账',async()=>{
 const calls=[],client={release:vi.fn(),query:async q=>{calls.push(q.text);if(q.text==='COMMIT')throw Error('connection lost');return {};}};
 const result=await baselineTransaction({connect:async()=>client},Date.now()+35000,async()=>({execution_ready:false,new_version_id:'candidate'}));
 expect(result).toMatchObject({committed:null,commit_outcome:'unknown',requires_reconciliation:true,execution_ready:false});expect(calls).not.toContain('ROLLBACK');expect(client.release).toHaveBeenCalledWith(true);
});
