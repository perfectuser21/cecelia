/** Brain正常任务 → 已安装冻结CLI → 真实终态与中央Span收割。 */
import { execFile, spawn } from 'node:child_process';
import { sshWithStdin,sshRun } from './ssh-exec.js';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { resolvePrimaryWorkerId,sshTargetFor } from '../machine-registry.js';
import { prepareLeadgenPlan } from './leadgen-dispatch-contract.js';
import { buildLeadgenBatchProbe } from './leadgen-batch-proof.js';
import { buildLeadgenLaunch,buildLeadgenProbe } from './leadgen-controller.js';
import { checkDeviceLockForManualDispatch } from './manual-dispatch-device-gate.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { setBrainLease,BRAIN_LEASE_MARGIN_SECONDS } from './task-lease.js';
import { startRun,finishRun } from './task-run.js';
import { finalizeTask } from './task-terminal.js';
import { recordTaskEventSafe } from './task-event-log.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
import { verifiedEmptyOutreach } from './leadgen-empty-terminal.js';
import { reconcileRunEvidence } from './run-reconciliation.js';
const CLAIMER='leadgen-run-dispatch';
export const LEADGEN_SSH_ARGS=SSH_BASE_ARGS.filter((v,i,a)=>v!=='StrictHostKeyChecking=no'&&!(v==='-o'&&a[i+1]==='StrictHostKeyChecking=no'));
const target=()=>sshTargetFor(resolvePrimaryWorkerId());
const dispatch=({remote,input})=>sshWithStdin(spawn,[...LEADGEN_SSH_ARGS,'-o','StrictHostKeyChecking=yes',target(),remote],input,35_000);
const probe=remote=>sshRun(execFile,[...LEADGEN_SSH_ARGS,'-o','StrictHostKeyChecking=yes',target(),remote],{timeout:30_000,encoding:'utf8'});
const parse=text=>JSON.parse(String(text).trim());
async function mergePlan(pool,id,input){
  const {launch_state,...plan}=input;
  return pool.query(`UPDATE tasks SET payload=COALESCE(payload,'{}'::jsonb)||jsonb_build_object('run_id',$2::text,'leadgen_run',$3::jsonb,'leadgen_launch_state',$4::text,'workflow_id',$5::text,'external_business_run_id',$6::text),updated_at=NOW() WHERE id=$1`,[id,plan.controller_run_id,JSON.stringify(plan),launch_state,plan.workflow_id,plan.business_run_id]);
}
async function terminal(pool,t,status,reason,evidence,deps){
  await (deps.finalizeTask??finalizeTask)(pool,t.id,status,{onlyIfStatus:evidence.phase==='preflight'?'queued':['queued','in_progress'],...(evidence.phase==='preflight'?{where:{sql:'claimed_by IS NULL',params:[]}}:{}),...(reason?{set:{error_message:reason}}:{}),mergeResult:{leadgen_dispatch:{reason,...evidence}}});
}
export async function dispatchLeadgenTask(pool,task,deps={}) {
  const event=deps.recordEvent??recordTaskEventSafe;
  let plan;
  try{
    plan=await (deps.prepareLeadgenPlan??prepareLeadgenPlan)(pool,task,deps);
    if(plan.waiting)return 'waiting';
    const proof=await (deps.batchProof??(async p=>parse(await dispatch(buildLeadgenBatchProbe(p)))))(plan);
    if(!Number.isSafeInteger(proof?.eligible)||proof.eligible<0||proof.company_id!==plan.company_id)throw Error('公司/批次读回无效');
    if(!proof.eligible)return 'waiting';
  }catch(error){await terminal(pool,task,'failed',error.message,{phase:'preflight'},deps);return 'failed';}
  const claimed=await pool.query("UPDATE tasks SET claimed_by=$2,claimed_at=NOW() WHERE id=$1 AND status='queued' AND claimed_by IS NULL RETURNING id",[task.id,CLAIMER]);
  if(!claimed.rows?.length)return 'skipped';
  try {
  if(plan.machine!=='mmv'){
    const gate=await (deps.lockGate??(t=>checkDeviceLockForManualDispatch(t,CLAIMER)))({...task,payload:{...task.payload,device_serial:plan.serial,device_ttl_minutes:Math.ceil(plan.timeout_sec/60)+20}});
    if(!gate.pass){
      await pool.query("UPDATE tasks SET claimed_by=NULL,claimed_at=NULL WHERE id=$1 AND claimed_by=$2 AND status='queued'",[task.id,CLAIMER]);
      return 'waiting';
    }
  }
  // 先持久记账、租约和独立controller身份，再跨网起跑；SSH失联不回队、不放锁、不重发。
  await mergePlan(pool,task.id,{...plan,launch_state:'reserved'});
  await pool.query("UPDATE tasks SET status='in_progress',executor_kind='openclaw-agent',started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1 AND status='queued'",[task.id]);
  await (deps.setLease??setBrainLease)(pool,task.id,plan.timeout_sec+BRAIN_LEASE_MARGIN_SECONDS);
  const started=await (deps.startRun??startRun)({taskId:task.id,runId:plan.controller_run_id,source:'leadgen-dispatch',context:{workflow_key:plan.workflow_key,external_business_run_id:plan.business_run_id,source_binding_run_id:plan.source_binding_run_id??null}},{pool});
  if(!started?.id||started.run_id!==plan.controller_run_id)throw Error('控制器task_run未持久化');
  } catch(error) {
    if(plan.machine!=='mmv')await (deps.releaseLock??releaseDeviceLocksHeldBy)(task.id,pool);
    await terminal(pool,task,'failed',error.message,{phase:'before_launch'},deps);
    return 'failed';
  }
  try{
    const response=parse(await (deps.launch??(p=>dispatch(buildLeadgenLaunch(p))))(plan));
    if(!['started','already','running','reserved'].includes(response.state))throw Error('启动回执未核实');
    await mergePlan(pool,task.id,{...plan,launch_state:'acknowledged'});
    await event(pool,task.id,'leadgen_dispatch_started',{controller_run_id:plan.controller_run_id,business_run_id:plan.business_run_id});
  }catch{
    await mergePlan(pool,task.id,{...plan,launch_state:'unknown'});
    await event(pool,task.id,'leadgen_launch_unknown',{controller_run_id:plan.controller_run_id,business_run_id:plan.business_run_id,action:'read_only_reconcile_no_replay'});
  }
  return 'dispatched';
}
export async function validateLeadgenTerminal(pool,plan,response,deps={}) {
  if(response?.state!=='terminal')return null;
  if(!Number.isInteger(response.exit_code))throw Error('缺真实进程终态');
  if(response.exit_code!==0){
    const clean=response.receipt?.split_result?.results?.find(r=>r.activity==='cleanup');
    if(plan.machine!=='mmv'&&response.execution_started!==false&&!(clean?.status==='completed'&&clean.verification?.verified===true))throw Error('失败后的手机清场未核实');
    return {status:'failed',reason:`leadgen_cli_exit_${response.exit_code}`,receipt:response.receipt??null};
  }
  const receipt=response.receipt;
  if(!receipt||response.business_run_id!==plan.business_run_id)throw Error('业务运行身份不符');
  const binding=await (deps.getBinding??getRunDefinitionBinding)(pool,plan.business_run_id);
  if(!binding||binding.binding.source_kind!=='external'||binding.binding.release_id!==plan.release_id||binding.binding.workflow_definition_version_id!==plan.workflow_definition_version_id||binding.binding.snapshot_sha256!==plan.snapshot_sha256)throw Error('中央冻结运行绑定不符');
  const ack=receipt.binding_ack,frozen=receipt.frozen;
  if(ack?.id!==binding.binding.id||frozen?.read_frozen_verified!==true||binding.binding.payload?.runtime_snapshot_sha256!==frozen.snapshot_sha256||frozen.deployment?.source_commit!==plan.source_commit)throw Error('原件ACK/冻结runtime与中央身份不符');
  const result=receipt.split_result;
  if(result?.run_id!==plan.business_run_id||result.status!=='completed'||result.evidence_status!=='sent')throw Error('真实业务交付未完成');
  const spans=(await pool.query('SELECT * FROM spans WHERE run_id=$1 ORDER BY started_at,created_at',[plan.business_run_id])).rows;
  const reconciliation=reconcileRunEvidence({run_id:plan.business_run_id,context:binding,spans});
  if(verifiedEmptyOutreach(plan,receipt,binding,spans,reconciliation))return {status:'completed',business_outcome:'empty',outward_sent:0,actual_send_acceptance:false,receipt,reconciliation,external_business_run_id:plan.business_run_id};
  if(reconciliation.business_outcome!=='pass'||reconciliation.evidence_status!=='verified')throw Error('中央完整路径证据未通过');
  const scoring=result.results?.find(r=>r.activity==='scoring')?.result;
  const scoreFacts=plan.workflow_key==='douyin_comment_scoring'?{scored_count:Number.isSafeInteger(scoring?.scored)?scoring.scored:null,scoring_outcome:scoring?.scored===0?'empty':Number.isSafeInteger(scoring?.scored)&&scoring.scored>0?'scored':'unknown',actual_scoring_acceptance:Number.isSafeInteger(scoring?.scored)&&scoring.scored>0}:{};
  return {status:'completed',receipt,reconciliation,...scoreFacts,external_business_run_id:plan.business_run_id};
}
export async function reapLeadgenTask(pool,task,deps={}){
  const plan=task.payload.leadgen_run;
  if(!plan||plan.controller_run_id!==task.run_id)return null;
  let response;
  try{response=await (deps.probe??(async p=>parse(await probe(buildLeadgenProbe(p)))))(plan);}catch{return null;}
  if(response.state!=='terminal')return null;
  let outcome;
  try{outcome=await validateLeadgenTerminal(pool,plan,response,deps);}catch(error){
    // 进程确已结束但证据未齐仍可补送；不将暂时未见绑定/Span冒充成功或重发业务。
    await (deps.recordEvent??recordTaskEventSafe)(pool,task.id,'leadgen_terminal_evidence_pending',{reason:error.message,business_run_id:plan.business_run_id});return null;
  }
  if(!outcome)return null;
  await terminal(pool,task,outcome.status,outcome.reason??null,outcome,deps);
  if(plan.machine!=='mmv')await (deps.releaseLock??releaseDeviceLocksHeldBy)(task.id,pool);
  const facts=Object.fromEntries(['business_outcome','outward_sent','actual_send_acceptance','scored_count','scoring_outcome','actual_scoring_acceptance'].filter(k=>outcome[k]!==undefined).map(k=>[k,outcome[k]]));
  await (deps.finishRun??finishRun)({runId:plan.controller_run_id,status:outcome.status,exitCode:response.exit_code,result:{external_business_run_id:plan.business_run_id,reconciliation:outcome.reconciliation??null,...facts}},{pool});
  return outcome.status;
}
