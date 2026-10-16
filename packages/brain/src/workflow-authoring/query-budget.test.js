import {it,expect,vi} from 'vitest';
import {budgetDatabase} from './query-budget.js';
it('连接超时后迟到连接会释放，不进入事务',async()=>{
 const release=vi.fn(),query=vi.fn();const db=budgetDatabase({connect:()=>new Promise(r=>setTimeout(()=>r({release,query}),30))},{deadline:Date.now()+5});
 await expect(db.connect()).rejects.toMatchObject({code:'readiness_deadline_exceeded'});
 await new Promise(r=>setTimeout(r,40));expect(release).toHaveBeenCalledOnce();expect(query).not.toHaveBeenCalled();
});
it('撤销后不得提交，真实query携局部timeout',async()=>{
 const query=vi.fn(async()=>({rows:[]})),controller=new AbortController();
 const db=budgetDatabase({connect:async()=>({query,release(){}})},{deadline:Date.now()+1000,signal:controller.signal});
 const client=await db.connect();await client.query('BEGIN');controller.abort();
 await expect(client.query('COMMIT')).rejects.toMatchObject({code:'readiness_deadline_exceeded'});
 expect(query.mock.calls[0][0]).toMatchObject({text:'BEGIN',query_timeout:expect.any(Number)});
});
it('主动abort不等长连接deadline；SQL读超时销毁连接且cleanup有界',async()=>{
 const controller=new AbortController(),release=vi.fn();
 const db=budgetDatabase({connect:()=>new Promise(resolve=>setTimeout(()=>resolve({release,query:vi.fn()}),30))},{deadline:Date.now()+10000,signal:controller.signal});
 const pending=db.connect();controller.abort();await expect(pending).rejects.toMatchObject({code:'readiness_deadline_exceeded'});
 await new Promise(resolve=>setTimeout(resolve,40));expect(release).toHaveBeenCalledOnce();
 const released=vi.fn(),error=Error('Query read timeout'),query=vi.fn(async()=>{throw error;});
 const client=await budgetDatabase({connect:async()=>({query,release:released})}).connect();
 await expect(client.query('BEGIN')).rejects.toBe(error);await expect(client.query('ROLLBACK')).rejects.toBe(error);client.release();
 expect(released).toHaveBeenCalledWith(error);expect(query.mock.calls[1][0]).toEqual({text:'ROLLBACK',query_timeout:5000});
});
