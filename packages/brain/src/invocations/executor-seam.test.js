import {it,expect,vi} from 'vitest';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {isRetiredDecomposition, RETIRED_DECOMPOSITION} from '../lib/retired-decomposition.js';
it('公共Invocation分流不构造父整包prompt，只有Runner提交的子Activity可进入原桥',async()=>{
 const source=readFileSync(new URL('../executor.js',import.meta.url),'utf8');
 const expression=source.match(/async function triggerCodexBridge\([^]*?^\}/m)[0];
 const activeProcesses=new Map();const fetch=vi.fn(async()=>({ok:true,json:async()=>({ok:true})}));let childExecute;
 const run=vi.fn(()=>new Promise(()=>{}));const forbidden=()=>{throw Error('整包旁路');};
 const fn=vm.runInNewContext(`(${expression})`,{isRetiredDecomposition,RETIRED_DECOMPOSITION,assertExternalExecutionAllowed(){},generateRunId:()=> 'parent-run',console:{log(){},error(){}},process:{env:{}},AbortSignal,JSON,activeProcesses,
  prepareInvocationDispatch:async()=>({already:false,envelope:{}}),updateTaskRunInfo:async()=>({success:true}),selectBestBridge:async()=> 'http://fixed-bridge',selectCodexAccounts:async()=>[],
  createInvocationActivityExecutor:(_db,options)=>{childExecute=options.submitActivity;return 'worker';},runInvocationActivities:run,buildCodexPromptContent:forbidden,
  buildCodexBridgePayload:(task,runId,prompt)=>({task_id:task.id,run_id:runId,prompt}),withLegacyExecution:async(_identity,operation)=>operation(),fetch,pool:{},finishInvocationRun:forbidden});
 const result=await fn({id:'parent',task_type:'research',payload:{invocation:{}}});expect(result.executor).toBe('shared-activity-runner');expect(activeProcesses.get('parent')).toMatchObject({source:'shared-activity-runner',runId:'parent-run'});expect(typeof activeProcesses.get('parent').invocationController.then).toBe('function');expect(fetch).not.toHaveBeenCalled();expect(run.mock.calls[0][3].executeSkill).toBe('worker');
 await childExecute({task_id:'child',run_id:'child-run',prompt:'single fixed Skill',timeout_ms:1000});
 expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({task_id:'child',run_id:'child-run',prompt:'single fixed Skill'});
});
it('已预留的子Activity即使重进通用派发也不再发送/run',async()=>{
 const expression=readFileSync(new URL('../executor.js',import.meta.url),'utf8').match(/async function triggerCodexBridge\([^]*?^\}/m)[0];
 const forbidden=vi.fn(()=>{throw Error('duplicate');});
 const fn=vm.runInNewContext(`(${expression})`,{isRetiredDecomposition,RETIRED_DECOMPOSITION,assertExternalExecutionAllowed(){},generateRunId:forbidden});
 const result=await fn({id:'child',payload:{invocation_activity:{child_run_id:'reserved'}}});expect(result.dispatchUncertain).toBe(true);expect(result.runId).toBe('reserved');expect(forbidden).not.toHaveBeenCalled();
});
it.each(['wrong-task','wrong-run','wrong-status','wrong-digest','not-queued'])('shared invocation 不信任不匹配待核凭证 %s',async kind=>{
 const {createHash}=await import('node:crypto');
 const expression=readFileSync(new URL('../executor.js',import.meta.url),'utf8').match(/async function triggerCodexBridge\([^]*?^\}/m)[0];
 const taskId='parent'; const runId='parent-run'; const activeProcesses=new Map(); const db={query:vi.fn(async()=>({rows:[]}))}; const finish=vi.fn(async()=>{});
 const fetch=vi.fn(async(_url,opts)=>{
   const body=JSON.parse(opts.body);
   const receipt={success:false,queued:true,task_id:taskId,run_id:runId,callback_status:body.status,receipt_sha256:createHash('sha256').update(JSON.stringify(body)).digest('hex'),code:'TASK_COMPLETION_GUARD_UNAVAILABLE'};
   if(kind==='wrong-task')receipt.task_id='other'; if(kind==='wrong-run')receipt.run_id='other';
   if(kind==='wrong-status')receipt.callback_status='AI Failed'; if(kind==='wrong-digest')receipt.receipt_sha256='bad'; if(kind==='not-queued')receipt.queued=false;
   return {ok:false,status:503,json:async()=>receipt};
 });
 const fn=vm.runInNewContext(`(${expression})`,{isRetiredDecomposition,RETIRED_DECOMPOSITION,assertExternalExecutionAllowed(){},generateRunId:()=>runId,console:{log(){},error(){}},process:{env:{}},AbortSignal,JSON,activeProcesses,crypto:{createHash},internalServiceHeaders:x=>x,
  prepareInvocationDispatch:async()=>({already:false,envelope:{}}),updateTaskRunInfo:async()=>({success:true}),selectBestBridge:async()=> 'http://fixed-bridge',selectCodexAccounts:async()=>[],createInvocationActivityExecutor:()=> 'worker',
  runInvocationActivities:async()=>({receipt:{ok:true}}),withLegacyExecution:async(_i,op)=>op(),fetch,pool:db,finishInvocationRun:finish});
 await fn({id:taskId,task_type:'research',payload:{invocation:{}}}); await activeProcesses.get(taskId).invocationController;
 expect(db.query).toHaveBeenCalledOnce(); expect(String(db.query.mock.calls[0][0])).toContain("status='blocked'"); expect(finish).toHaveBeenCalledOnce();
});
