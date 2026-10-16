/** 读取执行器实际持久化的同一回执；文字PASS、别次运行和不完整槽位均无资格。 */
import {definitionDigest,requireCondition} from './contracts.js';
import {validateSkillReceipt} from '../orchestrator/skill-activity-adapter.js';
const equal=(a,b)=>definitionDigest(a)===definitionDigest(b);
export function invocationSlotInputs(envelope,receipt) {
  const previous=Object.create(null);
  return envelope.activities.map((activity,index)=>{
    const input=Object.fromEntries(Object.entries(activity.input_mapping).map(([key,path])=>{
      const direct=path.match(/^\$input\.([\w]+)$/),prior=path.match(/^\$activity\.(.+)\.([\w]+)$/);
      requireCondition(direct||prior&&Object.hasOwn(previous,prior[1]),'活动输入映射缺失');
      return [key,direct?envelope.input[direct[1]]:previous[prior[1]][prior[2]]];
    }));
    previous[activity.key]=receipt.activities[index].outputs;
    return {key:activity.key,input,input_sha256:definitionDigest(input)};
  });
}
export function verifyInvocationLedger({task,runs,events,spans=[]},{requireSpans=false}={}) {
  const inv=task?.payload?.invocation,e=inv?.envelope,runId=inv?.dispatch?.run_id;
  requireCondition(inv&&runId&&['completed','completed_no_pr'].includes(task.status),'调用缺少已完成执行');
  requireCondition(inv.tenant_id===e.tenant_id&&inv.input_sha256===e.input_sha256&&equal(inv.target,e.target),'调用固定身份不一致');
  const receipt=validateSkillReceipt(e,task.result?.skill_invocation,task.id,runId),receiptHash=definitionDigest(receipt);
  const matches=p=>p?.run_id===runId&&p.tenant_id===inv.tenant_id&&p.input_sha256===inv.input_sha256&&equal(p.target,inv.target);
  const run=runs.filter(r=>r.run_id===runId&&r.task_id===task.id);
  requireCondition(run.length===1&&run[0].status==='success'&&matches({...run[0].context,run_id:runId})
    &&run[0].context.envelope_sha256===e.envelope_sha256,'运行账身份或成功回执不符');
  const final=events.filter(v=>v.event_type==='invocation_result_verified');
  requireCondition(final.length===1&&matches(final[0].payload)&&final[0].payload.actor==='brain'
    &&final[0].payload.envelope_sha256===e.envelope_sha256&&final[0].payload.receipt_sha256===receiptHash,'执行回执事件摘要不符');
  const reserved=events.filter(v=>v.event_type==='invocation_dispatch_reserved');
  requireCondition(reserved.length===1&&matches(reserved[0].payload)&&reserved[0].payload.actor==='brain'
    &&reserved[0].payload.envelope_sha256===e.envelope_sha256,'派发预留证据不符');
  const activityEvents=events.filter(v=>v.event_type==='invocation_activity_completed');
  requireCondition(activityEvents.length===e.activities.length,'活动执行证据数量不符');
  const inputs=invocationSlotInputs(e,receipt);
  for(const [index,activity] of e.activities.entries()){
    const found=activityEvents.filter(v=>v.payload.key===activity.key),result=receipt.activities[index];
    requireCondition(found.length===1&&matches(found[0].payload)&&found[0].payload.actor==='codex-bridge'
      &&found[0].payload.skill_sha256===activity.skill_sha256&&equal(found[0].payload.outputs,result.outputs),'活动执行证据不符');
    if(requireSpans){
      const trace=e.candidate_trace,slot=trace?.slots?.find(s=>s.slot_key===activity.key),p=found[0].payload;
      requireCondition(slot&&p.envelope_sha256===e.envelope_sha256&&p.slot_input_sha256===inputs[index].input_sha256,'候选活动固定来源缺失');
      const expected=[{step_id:null},...(slot.steps??[]).map(s=>({step_id:s.id}))];
      for(const target of expected){
        const selected=spans.filter(s=>s.run_id===runId&&s.evidence?.slot_key===activity.key&&(s.step_id??null)===target.step_id);
        requireCondition(selected.length===1,'真实活动或Step span缺失');
        const s=selected[0],proof=s.evidence;
        requireCondition(s.workflow_id===trace.workflow_id&&s.activity_id===slot.activity_id&&s.outcome==='pass'&&s.ended_at
          &&proof.protocol==='authoring-candidate-span-v1'&&proof.tenant_id===inv.tenant_id&&proof.task_id===task.id
          &&proof.envelope_sha256===e.envelope_sha256&&proof.receipt_sha256===receiptHash
          &&proof.workflow_definition_version_id===trace.workflow_definition_version_id
          &&proof.activity_definition_version_id===slot.activity_definition_version_id
          &&proof.input_sha256===inputs[index].input_sha256&&proof.skill_sha256===activity.skill_sha256
          &&equal(proof.outputs,result.outputs),'真实span固定身份或产物不符');
      }
    }
  }
  return {task_id:task.id,run_id:runId,tenant_id:inv.tenant_id,target:inv.target,input_sha256:inv.input_sha256,
    envelope_sha256:e.envelope_sha256,receipt_sha256:receiptHash,activities:receipt.activities,slot_inputs:inputs,outputs:receipt.outputs};
}
