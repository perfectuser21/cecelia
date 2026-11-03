import {runActivityContract} from '../orchestrator/activity-runtime.js';
import {createCommanderBridge} from '../orchestrator/runner-commander-bridge.js';
import {trustedCommanderTransport} from '../orchestrator/activity-supervision.js';

const routes={done:'next',empty:'next',retry:'pause',failed:'pause',partial:'pause',needs_review:'pause'};
const contract={workflow:'workflow_assembly_reconcile.internal',on_status:routes,activities:[{
 key:'reconcile_round',order:1,budget:{max_duration_s:20,heartbeat_s:5},
 failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:['native_round_unconfirmed']}},
 runtime:{protocol:'json-stdio-v1',entry:'workflow-assembly-reconcile-runner.js',phase:'source',executor_kind:'code',max_attempts:1,retry_safe:false},
}]};
const validReport=r=>r&&['checked','errors','skipped_objects'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0);
/** 在原会话锁内监督一个有界代码Activity；不另起run，不重放修复写入。 */
export async function runSupervisedNativeRound(execute,{runId,definitionVersion,readback,transport,signal,onEvent=async()=>{}}={}){
 if(!transport){try{transport=trustedCommanderTransport();}catch(error){transport=async()=>{throw error;};}}
 const events=[];
 const emit=async event=>{const numbered={...structuredClone(event),runner_event_seq:events.length+1};events.push(numbered);await onEvent(numbered);};
 const commander=createCommanderBridge({run_id:runId,brief:{purpose:'有界对账与修复；结果不授业务资格'},rules:['原会话锁持有至真实执行结束','未知修复结果只读回，不重放'],
  budget:{max_steers:0,max_recovery_turns:0,max_calls:12,timeout_ms:500},transport,onEvent:emit});
 let report,error,receipt;
 try{
  await commander.wake();
  receipt=await runActivityContract(contract,{run_tag:runId},{signal,commander,onEvent:emit,
   executeActivity:async(_a,input)=>{
    try{report=await execute();}catch(e){error=e;throw e;}
    return {schema_version:1,run_tag:input.run_tag,status:report.stopped||report.errors?'needs_review':report.checked===0?'empty':'completed',
     failure_class:report.stopped||report.errors?'needs_human':null,outputs:{report},metrics:{},evidence:[]};
   },
   checkActivity:async(_a,_result,{phase})=>{
    const state=await readback();
    if(state?.run_id!==runId||state?.outcome!=='running'||state?.definition_version!==definitionVersion)
     return {verdict:'unknown',reason:'native_round_owner_unconfirmed'};
    if(phase==='start')return {verdict:'pass',reason:'native_round_owner_readback'};
    return {verdict:validReport(report)&&!report.stopped&&report.errors===0?'pass':validReport(report)&&report.errors>0?'fail':'unknown',reason:'native_round_code_check'};
   },
  });
 }finally{await commander.sleep();}
 return {report:report??{checked:0,skipped_objects:0,errors:1},receipt:{...receipt,commander_status:commander.status},events,error};
}
