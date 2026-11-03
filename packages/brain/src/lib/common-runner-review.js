import {transaction} from '../execution-directory/store.js';
import {assertOwnerDecisionProtocol, openOwnerDecisionPendingAction} from './owner-decision.js';
import {recordTaskEventSafe} from './task-event-log.js';

export const resourceFreeReview = receipt => receipt?.cleanup_required === false && receipt.execution_unknown === false;

/** 只有完整独立记录与清场已确认的运行才能暂停任务；本事务不触碰资源或重启业务。 */
export async function blockCommonRunnerForReview(pool, task, runId, observed, {recordEvent = recordTaskEventSafe, now = Date.now()} = {}) {
  if (observed?.authenticated !== true || observed.central_run?.recording_status !== 'confirmed'
    || observed.central_run.status !== 'needs_review' || observed.receipt?.status !== 'needs_review'
    || observed.receipt.execution_unknown === true || (!resourceFreeReview(observed.receipt) && observed.receipt.validation?.cleanup?.verdict !== 'pass')) return {blocked: false};
  const detail = {question: `公共Runner运行 ${runId} 未通过独立检查，请审查证据并决定后续工作。`,
    options: ['A 保持暂停并保留证据', 'B 审查完成后另行登记后续工作'], default: 'A',
    deadline: new Date(now + 24 * 3600000).toISOString(), reversible: false, waiting_on: 'human',
    run_id: runId, business_status: 'needs_review', evidence_ref: `brain:spans:${runId}`};
  assertOwnerDecisionProtocol({reason: 'owner_decision', detail});
  const summary = `公共Runner ${runId} 需要主理人审查；记录与清场已独立确认，业务保持暂停。`;
  const review = {actor: 'common-runner', summary, evidence: {run_id: runId, central_status: 'needs_review',
    validation: observed.receipt.validation, writeback: observed.receipt.writeback},
  handoff: {summary, next_steps: []}};
  const changed = await transaction(pool, async db => {
    const updated = await db.query(`UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='owner_decision',
      blocked_detail=$3::jsonb,blocked_until=$4,payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{owner_decision}',$3::jsonb,true),
      result=jsonb_set(COALESCE(result,'{}'::jsonb),'{common_runner,business_status}','"needs_review"'::jsonb,true)||$5::jsonb,
      updated_at=NOW()
      WHERE id=$1 AND status='in_progress' AND claimed_by='common-runner'
        AND result->'common_runner'->>'run_id'=$2 RETURNING *`,
    [task.id, runId, JSON.stringify(detail), detail.deadline, JSON.stringify({common_runner_review: review})]);
    if (updated.rowCount !== 1) return false;
    await openOwnerDecisionPendingAction(db, {taskId: task.id, title: updated.rows[0].title ?? task.title, detail});
    return true;
  });
  if (changed) await recordEvent(pool, task.id, 'common_runner_needs_review', {run_id: runId,
    central_status: 'needs_review', evidence_ref: detail.evidence_ref, waiting_on: 'human', reversible: false});
  return {blocked: changed};
}
