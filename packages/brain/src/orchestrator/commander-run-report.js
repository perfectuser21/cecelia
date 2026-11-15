import {mergeLedgerSnapshots} from './commander-usage-ledger.js';
import {summarize} from './commander-usage-ledger-summary.js';
import {digest} from './commander-decision.js';
const number=value=>Number.isFinite(value)?value:null;
const interval=(start,end)=>({started_at_ms:number(start),ended_at_ms:number(end),duration_ms:Number.isFinite(start)&&Number.isFinite(end)&&end>=start?end-start:null});
const mismatch=()=>{throw Error('report_identity_mismatch');};
/** 只组合已观察事实；DBOS成功与业务成功分别展示，缺失值不补零。 */
export function buildCommanderRunReport({run,workflow,steps=[],actions=[],observedLedger=null,supervision=null,ledgerUnavailable=null}){
 const identity={task_id:run.task_id,run_id:run.run_id};
 const verify=value=>{if(value&&(value.task_id!==identity.task_id||value.run_id!==identity.run_id))mismatch();};
 if(workflow?.workflowID!==`commander-foundation:${run.run_id}`)mismatch();
 const original=workflow.input?.[0];
 if(original){
  const definition=value=>{const out={...value,commander_timeout_ms:value.commander_timeout_ms??60000,contract:{...value.contract,activities:[...value.contract.activities].sort((a,b)=>a.order-b.order)}};delete out.runtime_revision;delete out.definition_sha256;return out;};
  if(digest(definition(original))!==digest(definition(run)))mismatch();
 }
 const output=workflow.output??{};
 if(output.task_id!==undefined||output.run_id!==undefined)verify(output);
 for(const action of actions){if(!action.identity)mismatch();verify(action.identity);if(original?.definition_sha256&&action.identity.definition_sha256!==original.definition_sha256)mismatch();}
 const saved=output.run_report??steps.find(s=>s.name==='commanderFoundationRunReport')?.output;
 if(saved?.task_id!==undefined)verify(saved);
 verify(saved?.ledger?.identity);verify(observedLedger?.identity);
 if(supervision?.run_id!==undefined&&supervision.run_id!==identity.run_id)mismatch();
 const ledger=mergeLedgerSnapshots(saved?.ledger,observedLedger);
 const usageFor=calls=>ledger?summarize({...ledger,calls}).summary:{total_tokens:null,cost:{kind:'unknown',total_usd:null}};
 const status=output.status??(workflow.status==='ERROR'?'failed':workflow.status==='SUCCESS'?'unknown':'running');
 const activities=run.contract.activities.map(activity=>{
  const action=actions.find(a=>(a.activity_key??a.identity?.activity_key)===activity.key);
  const attempts=ledger?.attempts.filter(a=>a.activity_key===activity.key)??[];
  const calls=ledger?.calls.filter(c=>c.activity_key===activity.key)??[];
  const observations=ledger?.observations.filter(o=>o.activity_key===activity.key)??[];
  const receipt=action?.result??output.receipts?.find(r=>r.activity_key===activity.key);
  const ends=attempts.map(a=>a.ended_at_ms),starts=attempts.map(a=>a.started_at_ms);
  const start=starts.length&&starts.every(Number.isFinite)?Math.min(...starts):null;
  const end=ends.length&&ends.every(Number.isFinite)?Math.max(...ends):null;
  return {activity_key:activity.key,executor_kind:activity.runtime.executor_kind,phase:activity.runtime.phase,
   action_id:action?.action_id??action?.identity?.action_id??null,action_state:action?.state??'unobserved',
   status:receipt?.status??(attempts.length?attempts.at(-1).status:'unobserved'),timing:interval(start,end),
   attempt_count:ledger?attempts.length:null,retry_count:ledger?Math.max(0,attempts.length-1):null,
   attempts,observations,calls,usage:usageFor(calls),receipt:receipt??null};
 });
 const {started_at_ms,ended_at_ms,duration_ms}=interval(workflow.createdAt,workflow.completedAt);
 return {schema_version:1,identity,workflow:run.contract.workflow,status,dbos_status:workflow.status??'unknown',
  business_pass:output.business_pass??null,cleanup_status:output.cleanup_status??'unknown',reason_code:output.reason??null,
  started_at_ms,ended_at_ms,duration_ms,dbos_recovery_attempts:number(workflow.recoveryAttempts),host_start_count:number(supervision?.starts),
  usage:ledger?{status:ledger.coverage.complete?'complete':'incomplete',...ledger.summary,coverage:ledger.coverage,as_of_ms:ledger.as_of_ms,
   by_role:Object.fromEntries(['commander','activity'].map(role=>[role,usageFor(ledger.calls.filter(c=>c.role===role))])),
   commander_calls:ledger.calls.filter(c=>c.role==='commander'),activity_calls:ledger.calls.filter(c=>c.role==='activity'),pending_call_ids:ledger.pending_call_ids}
   :{status:'unavailable',total_tokens:null,cost:{kind:'unknown',total_usd:null}},
  ledger,ledger_unavailable:ledgerUnavailable,activities,
  checkpoints:steps.map(s=>({function_id:s.functionID,name:s.name,...interval(s.startedAtEpochMs,s.completedAtEpochMs),failed:!!s.error})),
  next_action:status==='completed'?'已完成；保留账单与证据':status==='running'?'继续观察当前运行':'核对原动作与证据，禁止盲目重发',
  budget_enforcement:'模型调用边界准入；已启动CLI调用可能超过阈值；CLI调用次数不代表HTTP请求次数'};
}
