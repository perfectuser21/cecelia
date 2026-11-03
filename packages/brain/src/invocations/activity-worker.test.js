import {it,expect} from 'vitest';
import {createInvocationActivityExecutor} from './activity-worker.js';
it('子Activity只登记一次并读匹配run终态，不以HTTP接受当成功',async()=>{
 const submitted=[],writes=[];let reads=0;
 const identity={task_id:'parent',run_id:'parent-run',tenant_id:'t',activity:'one',attempt:1};
 const request={identity,skill:{implementation:{repo:'perfectuser21/cecelia',revision:'a'.repeat(40),path:'skills/pure/SKILL.md'},sha256:'digest'},input:{}};
 const client={release(){},query:async(sql,args)=>{writes.push({sql,args});return {rows:[]};}};
 const db={connect:async()=>client,query:async(sql)=>{reads++;return {rows:sql.includes('FROM task_runs')?[{status:'success',ended_at:'now',context:{invocation_activity:identity},run_id:'child-run'}]:[{status:'completed',payload:{last_run_result:{run_id:'child-run',result_summary:{protocol:'skill-activity-result-v1',...identity,outputs:{}}}}}]};}};
 const worker=createInvocationActivityExecutor(db,{task:{id:'parent',payload:{invocation:{request_key:'key'}}},runId:'parent-run',createTask:async()=>({task_id:'child',task:{id:'child'}}),start:async()=>({id:'row'}),id:()=> 'child-run',submitActivity:async value=>{submitted.push(value);return {ok:true};},pollMs:0});
 const result=await worker(request,{budget:{max_duration_s:1}});expect(result.protocol).toBe('skill-activity-result-v1');expect(submitted).toHaveLength(1);expect(submitted[0].task_id).toBe('child');expect(submitted[0].prompt).not.toContain('activities');expect(reads).toBe(2);
});
it('派发未知不重发、不假称子进程停止，原子任务记录保留',async()=>{
 let submits=0;const client={release(){},query:async()=>({rows:[]})};
 const db={connect:async()=>client,query:async()=>({rows:[]})};
 const worker=createInvocationActivityExecutor(db,{task:{id:'parent',payload:{invocation:{request_key:'key'}}},runId:'parent-run',createTask:async()=>({task_id:'child'}),start:async()=>({id:'row'}),id:()=> 'child-run',submitActivity:async()=>{submits++;throw Error('lost');},pollMs:1});
 await expect(worker({identity:{task_id:'parent',run_id:'parent-run',tenant_id:'t',activity:'one',attempt:1},skill:{implementation:{repo:'repo'}}},{budget:{max_duration_s:0.002}})).rejects.toMatchObject({executionStopped:false});expect(submits).toBe(1);
});
it('run先结束但callback尚未原子写回task时继续读回，不误判失败',async()=>{
 let reads=0;const identity={task_id:'parent',run_id:'parent-run',tenant_id:'t',activity:'one',attempt:1};const client={release(){},query:async()=>({rows:[]})};
 const db={connect:async()=>client,query:async sql=>{if(sql.includes('FROM tasks')){reads++;return {rows:[reads===1?{status:'dispatched',payload:{}}:{status:'completed',payload:{last_run_result:{run_id:'child-run',result_summary:'readback'}}}]};}if(sql.includes('FROM task_runs'))return {rows:[{run_id:'child-run',status:'success',ended_at:'now',context:{invocation_activity:identity}}]};return {rows:[]};}};
 const execute=createInvocationActivityExecutor(db,{task:{id:'parent',payload:{invocation:{request_key:'k'}}},runId:'parent-run',createTask:async()=>({task_id:'child'}),start:async()=>({id:'row'}),id:()=> 'child-run',submitActivity:async()=>({ok:true}),pollMs:0});
 await expect(execute({identity,skill:{implementation:{repo:'fixed'}}},{budget:{max_duration_s:1}})).resolves.toBe('readback');expect(reads).toBe(2);
});
it('同一父run/activity/attempt幂等命中只读原子run，绝不换run重发',async()=>{
 const identity={task_id:'parent',run_id:'parent-run',tenant_id:'t',activity:'one',attempt:1};const started=[],submitted=[];const client={release(){},query:async()=>({rows:[]})};
 const db={connect:async()=>client,query:async sql=>({rows:sql.includes('FROM task_runs')?[{run_id:'original',status:'success',ended_at:'now',context:{invocation_activity:identity}}]:[{status:'completed',payload:{last_run_result:{run_id:'original',result_summary:'original readback'}}}]})};
 const execute=createInvocationActivityExecutor(db,{task:{id:'parent',payload:{invocation:{request_key:'key'}}},runId:'parent-run',createTask:async()=>({task_id:'child',deduplicated:true,task:{payload:{invocation_activity:{...identity,child_run_id:'original',skill_sha256:'sha'}}}}),start:async value=>{started.push(value);return {id:'r'};},id:()=> 'replacement',submitActivity:async value=>submitted.push(value),pollMs:0});
 await expect(execute({identity,skill:{sha256:'sha',implementation:{repo:'fixed'}}},{budget:{max_duration_s:0.01}})).resolves.toBe('original readback');expect(started).toEqual([]);expect(submitted).toEqual([]);
});
