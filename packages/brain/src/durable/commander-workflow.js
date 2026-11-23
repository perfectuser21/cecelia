import {DBOS} from '@dbos-inc/dbos-sdk';
import {activityStatus,activityRoute} from '../orchestrator/activity-judgment.js';
import {runSingleActivity} from '../orchestrator/activity-runtime.js';
import {normalizeCommanderRun, decisionRequest, parseCommanderDecision, actionIdentity, digest} from '../orchestrator/commander-decision.js';
import {repairFeedback, failureDecisionRequest} from '../orchestrator/commander-repair.js';
let runtime;
export function configureCommanderWorkflow(value) {
  if (DBOS.isInitialized() || !value || !/^[a-f0-9]{64}$/.test(value.revision ?? '')
    || ['decide','executeActivity','inspectActivity','checkActivity','verifySource'].some(k => typeof value[k] !== 'function')
    || ['reserve','settle'].some(k => typeof value.actionStore?.[k] !== 'function')) throw Error('commander_runtime_invalid');
  runtime = Object.freeze({...value});
}
function environment(run) {
  if (!runtime || runtime.revision !== run.runtime_revision) throw Error('commander_runtime_revision_mismatch');
  if(runtime.run&&(runtime.run.task_id!==run.task_id||runtime.run.run_id!==run.run_id||runtime.run.definition_sha256!==run.definition_sha256))throw Error('commander_identity_conflict');
  return runtime;
}
const review = (run, reason, receipts = []) => ({task_id:run.task_id,run_id:run.run_id,status:'needs_review',business_pass:false,reason,receipts});
async function bounded(fn, ms) {
  if (ms <= 0) throw Error('commander_deadline_exceeded');
  const controller = new AbortController(); let timer;
  try {return await Promise.race([fn(controller.signal),new Promise((_,reject) => {
    timer = setTimeout(() => {controller.abort();reject(Error('commander_timeout'));},ms);
  })]);} finally {clearTimeout(timer);}
}
const decide = DBOS.registerStep(async (run, request) => {
  const env = environment(run);
  const remaining = Math.min(run.commander_timeout_ms, run.deadline_ms - Date.now());
  if (remaining <= 0) return {error:'commander_deadline_exceeded'};
  try {await env.verifySource();} catch {return {error:'commander_source_unavailable'};}
  try {
    const value = await bounded(signal => env.decide(structuredClone(request),{signal,timeoutMs:remaining}),remaining);
    if (Date.now() >= run.deadline_ms) return {error:'commander_deadline_exceeded'};
    return {decision:parseCommanderDecision(value,request)};
  } catch (error) {return {error:/^usage_(?:(?:token|cost)_budget|budget|ledger)_/.test(error.message)?error.message:'commander_decision_unavailable'};}
},{name:'commanderFoundationDecide'});
function accepted(receipt, key) {
  const a = receipt?.activities?.[0];
  return receipt?.scope === 'activity' && receipt.activity_key === key
    && !receipt.reason_code && !receipt.event_failures?.length && receipt.status !== 'needs_review'
    && receipt.execution_unknown !== true && receipt.activities.length === 1 && a.key === key
    && a.validator_verdict?.verdict === 'pass' && a.attempts?.length === 1
    && a.attempts.every(x => ['completed','empty'].includes(x.status) && x.external_effect !== 'unknown'
      && x.execution_stopped !== false && x.adapter_result?.execution_stopped !== false);
}
function unverifiedReason(receipt){
  const reason=receipt?.activities?.[0]?.attempts?.at(-1)?.reason_code;
  return ['checker_archive_response_limit','checker_evidence_missing'].includes(reason)||/^usage_(?:(?:token|cost)_budget_(?:exceeded|unknown)|ledger_busy)$/.test(reason??'')?reason:'commander_activity_unverified';
}
const execute = DBOS.registerStep(async (run, key, context, attempt = 1, feedback, activityDeadline) => {
  const env = environment(run);
  const activity = run.contract.activities.find(a => a.key === key);
  const phaseDeadline=activity.runtime.phase==='finalize'?run.cleanup_deadline_ms:run.deadline_ms;
  await env.verifySource();
  const identity=actionIdentity(run,key,context,attempt,feedback);
  const requestedDeadline=activityDeadline??Math.min(phaseDeadline,Date.now()+activity.budget.max_duration_s*1000);
  const reservation = await env.actionStore.reserve(identity,{deadline_ms:requestedDeadline});
  const deadline = reservation.record.deadline_ms;
  if (!Number.isSafeInteger(deadline) || deadline > phaseDeadline || deadline <= 0 || (activityDeadline !== undefined && deadline !== activityDeadline)) throw Error('commander_action_deadline_invalid');
  if (reservation.record.state === 'settled') {
    const receipt=reservation.record.result;
    return {receipt,deadline_ms:deadline,safe:accepted(receipt,key)||receipt.execution_stopped===true,...(!accepted(receipt,key)?{error:unverifiedReason(receipt)}:{})};
  }
  const recovering = !reservation.created;
  async function stopReadback(){
    if(typeof env.inspectActivityStop!=='function'||activity.runtime.phase!=='source'
      ||!run.contract.activities.some(a=>a.runtime.phase==='finalize'))return undefined;
    try{
      const observed=await bounded(signal=>env.inspectActivityStop(activity,context,{
        identity,signal,deadlineMs:deadline,cleanupDeadlineMs:run.cleanup_deadline_ms,
      }),run.cleanup_deadline_ms-Date.now());
      if(observed===undefined)return undefined;
      if(observed?.execution_stopped===true&&observed.identity&&digest(observed.identity)===digest(identity)
        &&typeof observed.evidence_ref==='string'&&observed.evidence_ref)return observed.evidence_ref;
    }catch{}
    return null;
  }
  if(Date.now()>=deadline){
    if(!recovering)return {error:'commander_deadline_exceeded',safe:true};
    const evidence=await stopReadback();
    if(evidence!==undefined)return {error:'commander_deadline_exceeded',safe:Boolean(evidence),...(evidence?{cleanup_stop_evidence:evidence}:{})};
    try{const observed=await bounded(signal=>env.inspectActivity(activity,{...context,action_id:identity.action_id,recovery_mode:'readback_only'},{identity,signal,deadlineMs:deadline}),(run.cleanup_deadline_ms??deadline)-Date.now());return {error:'commander_deadline_exceeded',safe:observed?.execution_stopped===true&&observed.identity&&digest(observed.identity)===digest(identity)};}catch{return {error:'commander_deadline_exceeded',safe:false};}
  }
  let invoked=false,stopped=false;
  const receipt = await runSingleActivity(run.contract,run.input,{
    activityKey:key,context,deadlineMs:deadline,cwd:env.cwd,
    checkActivity:env.checkActivity,onEvent:env.onEvent,
    prepareInput:async(_a,input) => {
      // 反馈与轮数仅来自上一轮持久化验收，禁止业务输入冒充控制信。
      const clean={...input};
      if(activity.runtime.executor_kind!=='code'){delete clean.checker_feedback;delete clean.execution_attempt;}
      return {...clean,action_id:identity.action_id,...(activity.runtime.executor_kind==='agent'?{execution_attempt:attempt}:{}),
        ...(feedback?{checker_feedback:structuredClone(feedback)}:{}),...(recovering?{recovery_mode:'readback_only'}:{})};
    },
    executeActivity:async(a,input,options) => {
      invoked=true;
      if (!recovering) {
        try {const result=await bounded(signal => env.executeActivity(a,input,{...options,identity,signal,deadlineMs:deadline}),Math.max(0,deadline-Date.now()));stopped=result?.execution_stopped===true;return result;}
        catch (error) {stopped=error.executionStopped===true;if (error.message === 'commander_timeout') error.executionStopped = false; throw error;}
      }
      // 旧进程是否已停止与产物是否存在是两个事实，缺任一事实都不恢复执行权。
      const observed = await bounded(signal => env.inspectActivity(a,input,{...options,identity,signal,deadlineMs:deadline}),Math.max(0,deadline-Date.now()));
      stopped=observed?.execution_stopped===true&&observed.identity&&digest(observed.identity)===digest(identity);
      if (observed?.state !== 'completed' || observed.execution_stopped !== true || !observed.identity || digest(observed.identity) !== digest(identity)) return {
        schema_version:1,run_tag:input.run_tag,...(input.line_key === undefined ? {} : {line_key:input.line_key}),
        status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],external_effect:'unknown',reason_code:'action_readback_unconfirmed'};
      return observed.result;
    },
  });
  const safe=accepted(receipt,key)||(!invoked&&!recovering)||stopped;
  if(receipt.execution_unknown||receipt.activities.some(a=>a.attempts.some(x=>x.external_effect==='unknown'))){
    // 只把同动作的停稳证据交给独立收尾。原意图、外部未知与失败状态继续保留。
    const evidence=Date.now()>=deadline?await stopReadback():null;
    return {error:'commander_activity_unverified',receipt,deadline_ms:deadline,safe:Boolean(evidence),...(evidence?{cleanup_stop_evidence:evidence}:{})};
  }
  if(safe)receipt.execution_stopped=true;
  if(Date.now()>=deadline)return {error:'commander_deadline_exceeded',receipt,deadline_ms:deadline,safe};
  try {await env.verifySource();}catch{return {error:'commander_source_unavailable',receipt,deadline_ms:deadline,safe};}
  if(safe)await env.actionStore.settle(identity,receipt);
  return {receipt,deadline_ms:deadline,safe,...(!accepted(receipt,key)?{error:unverifiedReason(receipt)}:{})};
},{name:'commanderFoundationActivity'});

const verifyCompletion = DBOS.registerStep(async run => {
  try {await environment(run).verifySource();return {verified:true};}
  catch {return {error:'commander_source_unavailable'};}
},{name:'commanderFoundationVerifyCompletion'});

// 通过DBOS正常step保存调用账单；重放复用快照，不重发模型、不改已结算动作。
const recordRunReport = DBOS.registerStep(async (run, output) => {
  const ledger=environment(run).ledger;
  return {schema_version:1,task_id:run.task_id,run_id:run.run_id,workflow:run.contract.workflow,
    status:output.status,business_pass:output.business_pass,cleanup_status:output.cleanup_status??'not_required',
    reason_code:output.reason??null,ledger:ledger.snapshot(),
    budget_enforcement:'模型调用边界准入；一次已启动CLI调用可能超过token或费用阈值'};
},{name:'commanderFoundationRunReport'});

const workflow = DBOS.registerWorkflow(async value => {
  const run=normalizeCommanderRun(value),receipts=[],attemptHistory=[],context=structuredClone(run.input);
  const sources=run.contract.activities.filter(a=>a.runtime.phase==='source');
  const finalizer=run.contract.activities.find(a=>a.runtime.phase==='finalize');
  let reason=null,safe=true,stopped=false,escalation,cleanupStopEvidence;
  async function perform(a,attempt=1,feedback,deadline){
    try{return await execute(run,a.key,context,attempt,feedback,deadline);}
    catch(error){return {error:/^usage_(?:(?:token|cost)_budget|budget|ledger)_/.test(error.message)?error.message:'commander_activity_unavailable',safe:false};}
  }
  async function performWithRepair(a){
    let feedback,deadline;
    const limit=a.runtime.checker_repair?.max_attempts??1;
    for(let attempt=1;attempt<=limit;attempt++){
      const outcome=await perform(a,attempt,feedback,deadline);
      if(outcome.receipt)attemptHistory.push(outcome.receipt);
      if(!outcome.error)return outcome;
      deadline??=outcome.deadline_ms;
      const nextFeedback=repairFeedback(a,outcome,attempt);
      if(nextFeedback&&attempt<limit&&Number.isSafeInteger(deadline)){feedback=nextFeedback;continue;}
      const failureReason=nextFeedback&&attempt===limit&&limit>1?'checker_repair_exhausted':outcome.error;
      const request=failureDecisionRequest(run,receipts,a,attemptHistory,outcome,failureReason);
      // 把完整问题交给Commander；此处不能放宽契约、重置次数或放行下游。
      escalation=await decide(run,request);
      return {...outcome,error:failureReason};
    }
  }
  for(let sequence=0;sequence<=sources.length;sequence++){
    const next=stopped?null:(sources[sequence]??null);
    const request=decisionRequest(run,receipts,next);let response;
    for(let attempt=0;attempt<3;attempt++){response=await decide(run,request);if(response.decision||response.error!=='commander_decision_unavailable')break;}
    if(!response.decision){reason=response.error;break;}
    const choice=response.decision;
    if(choice.action==='pause'){reason='commander_paused';break;}
    if(choice.action==='complete')break;
    const outcome=await performWithRepair(next);safe=outcome.safe===true;
    cleanupStopEvidence=outcome.cleanup_stop_evidence;
    if(outcome.error){reason=outcome.error;break;}
    receipts.push(outcome.receipt);
    Object.assign(context,structuredClone(outcome.receipt.outputs));
    const result=outcome.receipt.activities[0].attempts[0];
    const route=activityRoute(run.contract,next,activityStatus(result),result,true);
    if(route==='stop')stopped=true;else if(route!=='next'){reason='commander_activity_route_paused';break;}
  }
  let cleanupStatus;
  if(finalizer){
    if(!safe)cleanupStatus='blocked';else {
      const outcome=await perform(finalizer);if(outcome.receipt){receipts.push(outcome.receipt);attemptHistory.push(outcome.receipt);}
      cleanupStatus=!outcome.error&&accepted(outcome.receipt,finalizer.key)?'completed':'needs_review';
      if(cleanupStatus!=='completed')reason ||= outcome.error??'commander_cleanup_unverified';
    }
  }
  if(!reason){const verification=await verifyCompletion(run);if(verification.error){reason=verification.error;if(finalizer)cleanupStatus='needs_review';}}
  const output=reason?review(run,reason,receipts):{task_id:run.task_id,run_id:run.run_id,status:'completed',business_pass:true,outputs:Object.assign({},...receipts.map(r=>r.outputs)),receipts};
  const result={...output,attempt_history:attemptHistory,...(escalation?{escalation}:{}),...(cleanupStatus?{cleanup_status:cleanupStatus}:{}),
    ...(cleanupStopEvidence?{cleanup_stop_evidence:cleanupStopEvidence}:{})};
  if(environment(run).ledger)result.run_report=await recordRunReport(run,result);
  return result;
},{name:'commanderFoundationWorkflow'});

/** 显式选择此入口才启用；不改变原公共Runner调度路径。 */
export async function startCommanderWorkflow(value) {
  const run = normalizeCommanderRun(value); environment(run);
  if (process.env.DBOS_DURABLE_ENABLED !== 'true' || !DBOS.isInitialized()) throw Error('commander_durable_unavailable');
  const workflow_id = `commander-foundation:${run.run_id}`;
  const handle = await DBOS.startWorkflow(workflow,{workflowID:workflow_id})(run);
  const [original] = await handle.getWorkflowInputs();
  if (normalizeCommanderRun(original).definition_sha256 !== run.definition_sha256) throw Error('commander_identity_conflict');
  return {workflow_id,handle};
}
