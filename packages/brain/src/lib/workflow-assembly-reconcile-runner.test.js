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
