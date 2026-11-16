import {decisionRequest,digest} from './commander-decision.js';

// 只有冻结策略与独立检查均明确允许，才把已停下的失败交回执行Agent。
export function repairFeedback(activity,outcome,attempt){
  const receipt=outcome.receipt,record=receipt?.activities?.[0],result=record?.attempts?.[0],feedback=result?.checker_feedback;
  if(!activity.runtime.checker_repair || outcome.safe!==true || !Number.isSafeInteger(outcome.deadline_ms)
    || receipt.execution_unknown || receipt.reason_code || receipt.event_failures?.length
    || receipt.activities.length!==1 || record.key!==activity.key || record.attempts.length!==1
    || record.validator_verdict?.verdict!=='fail' || result.reason_code!=='skill_check_failed'
    || result.execution_stopped!==true || result.external_effect==='unknown'
    || feedback?.protocol!=='checker-feedback/v1' || feedback.activity_key!==activity.key || feedback.attempt!==attempt
    || feedback.retryable!==true || !['none','known'].includes(feedback.external_effect)
    || typeof feedback.thread_id!=='string' || !feedback.thread_id || !feedback.failed_checks?.length)return null;
  return structuredClone(feedback);
}

export function failureDecisionRequest(run,receipts,activity,history,outcome,reason){
  const request=decisionRequest(run,receipts,null);
  const failed=outcome.receipt?.activities?.[0]?.attempts?.at(-1);
  const failure={activity_key:activity.key,reason,execution_stopped:outcome.safe===true,
    checker_feedback:failed?.checker_feedback??null,receipt:outcome.receipt??null,
    attempt_history:history.filter(r=>r.activity_key===activity.key)};
  return {...request,sequence:request.sequence+1,state_sha256:digest({receipts,failure}),failure,allowed_actions:[{action:'pause'}]};
}
