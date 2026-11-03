import {it,expect,vi} from 'vitest';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
it('公共Invocation分流不构造父整包prompt，只有Runner提交的子Activity可进入原桥',async()=>{
 const source=readFileSync(new URL('../executor.js',import.meta.url),'utf8');
 const expression=source.match(/async function triggerCodexBridge\([^]*?^\}/m)[0];
 const activeProcesses=new Map();const fetch=vi.fn(async()=>({ok:true,json:async()=>({ok:true})}));let childExecute;
 const run=vi.fn(()=>new Promise(()=>{}));const forbidden=()=>{throw Error('整包旁路');};
 const fn=vm.runInNewContext(`(${expression})`,{assertExternalExecutionAllowed(){},generateRunId:()=> 'parent-run',console:{log(){},error(){}},process:{env:{}},AbortSignal,JSON,activeProcesses,
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
 const fn=vm.runInNewContext(`(${expression})`,{assertExternalExecutionAllowed(){},generateRunId:forbidden});
 const result=await fn({id:'child',payload:{invocation_activity:{child_run_id:'reserved'}}});expect(result.dispatchUncertain).toBe(true);expect(result.runId).toBe('reserved');expect(forbidden).not.toHaveBeenCalled();
});
