import {DBOS} from '@dbos-inc/dbos-sdk';
import {runSingleActivity} from '../orchestrator/activity-runtime.js';
import {normalizeCommanderRun, decisionRequest, parseCommanderDecision, actionIdentity, digest} from '../orchestrator/commander-decision.js';
let runtime;
export function configureCommanderWorkflow(value) {
  if (DBOS.isInitialized() || !value || !/^[a-f0-9]{64}$/.test(value.revision ?? '')
    || ['decide','executeActivity','inspectActivity','checkActivity','verifySource'].some(k => typeof value[k] !== 'function')
    || ['reserve','settle'].some(k => typeof value.actionStore?.[k] !== 'function')) throw Error('commander_runtime_invalid');
  runtime = Object.freeze({...value});
}
function environment(run) {
  if (!runtime || runtime.revision !== run.runtime_revision) throw Error('commander_runtime_revision_mismatch');
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
  } catch {return {error:'commander_decision_unavailable'};}
},{name:'commanderFoundationDecide'});
function accepted(receipt, key) {
  const a = receipt?.activities?.[0];
  return receipt?.scope === 'activity' && receipt.activity_key === key && receipt.status === 'completed'
    && receipt.execution_unknown !== true && receipt.activities.length === 1 && a.key === key
    && a.validator_verdict?.verdict === 'pass' && a.attempts?.length === 1
    && a.attempts.every(x => ['completed','empty'].includes(x.status) && x.external_effect !== 'unknown'
      && x.execution_stopped !== false && x.adapter_result?.execution_stopped !== false);
}
const execute = DBOS.registerStep(async (run, key, context) => {
  const env = environment(run);
  if (Date.now() >= run.deadline_ms) return {error:'commander_deadline_exceeded'};
  await env.verifySource();
  const identity = actionIdentity(run,key,context), activity = run.contract.activities.find(a => a.key === key);
  const requestedDeadline = Math.min(run.deadline_ms,Date.now()+activity.budget.max_duration_s*1000);
  const reservation = await env.actionStore.reserve(identity,{deadline_ms:requestedDeadline});
  const deadline = reservation.record.deadline_ms;
  if (!Number.isSafeInteger(deadline) || deadline > run.deadline_ms || deadline <= 0) throw Error('commander_action_deadline_invalid');
  if (reservation.record.state === 'settled') {
    if (!accepted(reservation.record.result,key)) return {error:'commander_stored_receipt_invalid'};
    return {receipt:reservation.record.result};
  }
  if (Date.now() >= deadline) return {error:'commander_deadline_exceeded'};
  const recovering = !reservation.created;
  const receipt = await runSingleActivity(run.contract,run.input,{
    activityKey:key,context,deadlineMs:deadline,cwd:env.cwd,
    checkActivity:env.checkActivity,onEvent:env.onEvent,
    prepareInput:async(_a,input) => ({...input,action_id:identity.action_id,...(recovering ? {recovery_mode:'readback_only'} : {})}),
    executeActivity:async(a,input,options) => {
      if (!recovering) {
        try {return await bounded(signal => env.executeActivity(a,input,{...options,identity,signal}),Math.max(0,deadline-Date.now()));}
        catch (error) {if (error.message === 'commander_timeout') error.executionStopped = false; throw error;}
      }
      // 旧进程是否已停止与产物是否存在是两个事实，缺任一事实都不恢复执行权。
      const observed = await bounded(signal => env.inspectActivity(a,input,{...options,identity,signal}),Math.max(0,deadline-Date.now()));
      if (observed?.state !== 'completed' || observed.execution_stopped !== true || !observed.identity || digest(observed.identity) !== digest(identity)) return {
        schema_version:1,run_tag:input.run_tag,...(input.line_key === undefined ? {} : {line_key:input.line_key}),
        status:'needs_review',failure_class:'needs_human',outputs:{},metrics:{},evidence:[],external_effect:'unknown',reason_code:'action_readback_unconfirmed'};
      return observed.result;
    },
  });
  if (Date.now() >= deadline) return {error:'commander_deadline_exceeded',receipt};
  if (!accepted(receipt,key)) return {error:'commander_activity_unverified',receipt};
  return {receipt:await env.actionStore.settle(identity,receipt)};
},{name:'commanderFoundationActivity'});

const workflow = DBOS.registerWorkflow(async value => {
  const run = normalizeCommanderRun(value), receipts = [], context = structuredClone(run.input);
  for (let sequence = 0; sequence <= run.contract.activities.length; sequence++) {
    const request = decisionRequest(run,receipts);
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await decide(run,request);
      if (response.decision || response.error !== 'commander_decision_unavailable') break;
    }
    if (!response.decision) return review(run,response.error,receipts);
    const choice = response.decision;
    if (choice.action === 'pause') return review(run,'commander_paused',receipts);
    if (choice.action === 'complete') return {task_id:run.task_id,run_id:run.run_id,status:'completed',business_pass:true,
      outputs:Object.assign({},...receipts.map(r => r.outputs)),receipts};
    let outcome;
    try {outcome = await execute(run,choice.activity_key,context);} catch {return review(run,'commander_activity_unavailable',receipts);}
    if (outcome.error) return {...review(run,outcome.error,receipts),activity_receipt:outcome.receipt ?? null};
    receipts.push(outcome.receipt); Object.assign(context,structuredClone(outcome.receipt.outputs));
  }
  return review(run,'commander_decision_limit',receipts);
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
