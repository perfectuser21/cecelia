import { transitionGapStatus } from './gap-store.js';

/** Close repair gaps only from receipts bound to the exact repair run and active contract. */
export async function resolveCompletedRepairGaps(db, {
  repairTaskId,
  runId,
  transitionGap = transitionGapStatus,
}) {
  const candidateResult = await db.query(
    `SELECT DISTINCT ON (gap.id)
            gap.id AS gap_id,
            gap.current_revision,
            receipt.id AS receipt_id,
            assertion.value->>'assertion_id' AS assertion_id
       FROM harness_gaps AS gap
       JOIN harness_impact_contracts AS contract
         ON contract.task_id = gap.source_task_id
        AND contract.status = 'active'
       CROSS JOIN LATERAL jsonb_array_elements(
         contract.contract_body->'required_assertions'
       ) AS assertion(value)
       JOIN journey_assertion_receipts AS receipt
         ON receipt.run_id = $2
        AND receipt.source_repo = contract.repo
        AND receipt.source_sha = gap.current_revision
        AND receipt.impact_contract_id = contract.id
        AND receipt.impact_contract_hash = contract.contract_hash
        AND receipt.journey_step_link_id::TEXT = assertion.value->>'journey_step_link_id'
        AND receipt.assertion_revision = (assertion.value->>'assertion_revision')::BIGINT
        AND receipt.assertion_ref_snapshot = assertion.value->>'assertion_id'
        AND receipt.assertion_digest = assertion.value->>'assertion_digest'
        AND receipt.command_argv = jsonb_build_array('bash', '-lc', assertion.value->>'command')
        AND receipt.verdict = 'PASS'
        AND receipt.exit_code = 0
        AND receipt.synthetic = false
        AND receipt.executor_kind = 'brain_assertion_runner'
       JOIN initiative_runs AS verification_run
         ON verification_run.id::TEXT = receipt.run_id
        AND verification_run.current_task_id = gap.repair_task_id
      WHERE gap.repair_task_id = $1
        AND gap.status = 'verifying'
        AND assertion.value->'covers_capability_ids' ? gap.impact_node_id
        AND EXISTS (
          SELECT 1 FROM gap_events AS event
           WHERE event.gap_id = gap.id
             AND event.event_type = 'verification_started'
             AND receipt.completed_at >= event.created_at
        )
      ORDER BY gap.id, receipt.completed_at DESC`,
    [repairTaskId, runId],
  );

  const gapIds = [];
  for (const candidate of candidateResult.rows) {
    await transitionGap(db, candidate.gap_id, 'resolved', {
      actor: 'cecelia-brain',
      idempotencyKey: `auto-resolved:${candidate.gap_id}:${candidate.receipt_id}`,
      detail: { repair_task_id: repairTaskId, run_id: runId },
      resolutionEvidence: {
        assertion_id: candidate.assertion_id,
        receipt_id: candidate.receipt_id,
        revision: candidate.current_revision,
      },
    });
    gapIds.push(candidate.gap_id);
  }
  return { resolved: gapIds.length, gapIds };
}
