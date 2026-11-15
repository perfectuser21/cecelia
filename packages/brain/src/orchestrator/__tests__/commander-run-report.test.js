import {test,expect,vi} from 'vitest';
const sdk=vi.hoisted(()=>({initialized:false,steps:[],inputs:new Map()}));
vi.mock('@dbos-inc/dbos-sdk',()=>({DBOS:{isInitialized:()=>sdk.initialized,registerStep:(fn,options)=>{sdk.steps.push(options.name);return fn;},registerWorkflow:fn=>fn,startWorkflow:(fn,{workflowID})=>async input=>{sdk.inputs.set(workflowID,input);return {getWorkflowInputs:async()=>[input],getResult:()=>fn(input)};}}}));
import {configureCommanderWorkflow,startCommanderWorkflow} from '../../durable/commander-workflow.js';
import {randomUUID} from 'node:crypto';
function fixture(fail=false){
 const run={schema_version:1,task_id:randomUUID(),run_id:randomUUID(),runtime_revision:'a'.repeat(64),deadline_ms:Date.now()+10000,cleanup_deadline_ms:Date.now()+20000,commander_timeout_ms:1000,input:{run_tag:'ledger'},contract:{workflow:'ledger-scenario',activities:[{key:'report',order:1,budget:{max_duration_s:3,heartbeat_s:1},runtime:{phase:'source',executor_kind:'agent',entry:'report.mjs',protocol:'json-stdio-v1'},failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:[]}}}]}};
 const snapshot={schema_version:1,identity:{task_id:run.task_id,run_id:run.run_id},as_of_ms:Date.now(),calls:[{call_id:'native-call',status:fail?'failed':'completed',usage:fail?null:{input_tokens:12,output_tokens:3}}],summary:{total_tokens:fail?null:15},pending_call_ids:[]};
 const env={revision:run.runtime_revision,verifySource:async()=>{},ledger:{snapshot:()=>snapshot},decide:async req=>{if(fail)throw Error('usage_budget_exceeded');return {protocol:req.protocol,run_id:req.run_id,definition_sha256:req.definition_sha256,sequence:req.sequence,state_sha256:req.state_sha256,...req.allowed_actions[0],reason:'fixture'};},executeActivity:async(_a,input)=>({schema_version:1,run_tag:input.run_tag,status:'completed',outputs:{value:1},metrics:{},evidence:['real-artifact'],execution_stopped:true}),inspectActivity:async()=>{},checkActivity:async()=>({verdict:'pass'}),actionStore:{reserve:async(identity,{deadline_ms})=>({created:true,record:{identity,deadline_ms,state:'reserved'}}),settle:async(_i,r)=>r}};
 return {run,env,snapshot};
}
test.each([false,true])('DBOS保存统一账单快照，正常或预算失败仍保留用量：%s',async fail=>{
 const f=fixture(fail);sdk.initialized=false;configureCommanderWorkflow(f.env);sdk.initialized=true;
 try{const out=await (await startCommanderWorkflow(f.run)).handle.getResult();expect(out.run_report.ledger).toEqual(f.snapshot);expect(out.run_report.run_id).toBe(f.run.run_id);expect(sdk.steps).toContain('commanderFoundationRunReport');if(fail){expect(out.status).toBe('needs_review');expect(out.reason).toBe('usage_budget_exceeded');}else expect(out.status).toBe('completed');}finally{sdk.initialized=false;}
});
