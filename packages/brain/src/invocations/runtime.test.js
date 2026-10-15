import {it,expect} from 'vitest';
import {invocationTaskPrompt,prepareInvocationDispatch,guardInvocationCallback} from './runtime.js';
it('普通历史任务保持既有提示词与派发路径，不借调用器换执行体',async()=>{
 const task={id:'ordinary',payload:{}};
 expect(invocationTaskPrompt(task,'run')).toBe(null);
 await expect(prepareInvocationDispatch({},task,'run')).resolves.toBe(null);
});
it('未核验的调用快照不能进入真实执行提示词',()=>{
 expect(()=>invocationTaskPrompt({id:'task',payload:{invocation:{envelope:{protocol:'unknown'}}}},'run')).toThrow('未知调用协议');
});
it('回执run身份与服务端预留不符在任何终态写入前拒绝',async()=>{
 let reads=0;
 const db={query:async()=>{reads++;return {rows:[{payload:{invocation:{dispatch:{run_id:'original'}}}}]};}};
 await expect(guardInvocationCallback(db,{task_id:'task',run_id:'other',status:'AI Done',result:{}})).rejects.toThrow('run 身份');
 expect(reads).toBe(1);
});
