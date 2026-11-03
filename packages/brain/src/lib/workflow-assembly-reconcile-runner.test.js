import {it,expect,vi} from 'vitest';
import {runWorkflowAssemblyReconcile} from './workflow-assembly-reconcile-runner.js';
it('已取消轮在获取连接之前停止',async()=>{
 const controller=new AbortController();controller.abort();const pool={connect:vi.fn()};
 expect(await runWorkflowAssemblyReconcile(pool,{signal:controller.signal})).toMatchObject({stopped:'cancelled'});expect(pool.connect).not.toHaveBeenCalled();
});
it('连接池等待也有界，超时后迟到连接只归还不执行SQL',async()=>{
 let deliver;const waiting=new Promise(r=>deliver=r),client={release:vi.fn(),query:vi.fn()};
 const pool={connect:vi.fn(()=>waiting)};
 expect(await runWorkflowAssemblyReconcile(pool,{budgetMs:10})).toMatchObject({stopped:'budget'});
 deliver(client);await new Promise(r=>setImmediate(r));expect(client.release).toHaveBeenCalledOnce();expect(client.query).not.toHaveBeenCalled();
});
it('公共Runner执行期间持有同一会话锁，监督结束再落终态并解锁',async()=>{
 const order=[];
 const connection={release:vi.fn(()=>order.push('release')),query:vi.fn(async q=>{
  const sql=typeof q==='string'?q:q.text;
  if(sql.includes('current_database'))return {rows:[{database:'cecelia_scratch',schema:'public'}]};
  if(sql.includes('pg_try_advisory_lock')){order.push('lock');return {rows:[{locked:true}]};}
  if(sql.includes('pg_advisory_unlock'))order.push('unlock');
  if(sql.includes('INSERT INTO working_memory'))order.push('code');
  return {rows:[]};
 })};
 const result=await runWorkflowAssemblyReconcile({connect:async()=>connection},{onLocked:async()=>{order.push('claim');return true;},
  runLocked:async execute=>{order.push('runner_start');const report=await execute();order.push('runner_sleep');return report;},
  onSettled:async()=>{order.push('terminal');},
 });
 expect(result).toEqual({checked:0,skipped_objects:0,errors:0});
 expect(order).toEqual(['lock','claim','runner_start','code','runner_sleep','terminal','unlock','release']);
});
it('公共Runner抛错仍落错误终态并释放原会话资源',async()=>{
 const order=[];const connection={release:()=>order.push('release'),query:async q=>{
  const sql=q.text;if(sql.includes('current_database'))return {rows:[{database:'cecelia_scratch',schema:'public'}]};
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.includes('pg_advisory_unlock'))order.push('unlock');return {rows:[]};
 }};
 await expect(runWorkflowAssemblyReconcile({connect:async()=>connection},{runLocked:async()=>{throw Error('runner crash');},onSettled:async(_db,_report,error)=>{expect(error.message).toBe('runner crash');order.push('terminal');}})).rejects.toThrow('runner crash');
 expect(order).toEqual(['terminal','unlock','release']);
});
