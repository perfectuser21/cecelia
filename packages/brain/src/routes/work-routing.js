import { Router } from 'express';
import pool from '../db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9._/-]+$/;
const BRANCH = /^cp-[a-z0-9][a-z0-9._-]{0,126}$/;

export async function validateWorkRoutingIdentity(db, input = {}) {
  const { routing_receipt_id, task_id, run_id, repo, branch, base_sha } = input;
  if (
    !UUID.test(routing_receipt_id ?? '')
    || !UUID.test(task_id ?? '')
    || !UUID.test(run_id ?? '')
    || !REPO.test(repo ?? '')
    || !BRANCH.test(branch ?? '')
    || !SHA.test(base_sha ?? '')
  ) {
    return { status: 400, body: { valid: false, reason_code: 'route_violation' } };
  }
  const result = await db.query(
    `SELECT receipt.id,
            run.deadline_at AS expires_at,
            EXISTS (
              SELECT 1
                FROM work_routing_receipts successor
               WHERE successor.supersedes_receipt_id = receipt.id
            ) AS superseded,
            EXISTS (
              SELECT 1
                FROM harness_attempts attempt
               WHERE attempt.run_id = run.id
                 AND attempt.status IN ('starting', 'running')
                 AND attempt.task_bundle->'inputs'->'workspace_spec'->>'branch' = $5
                 AND attempt.task_bundle->'inputs'->'workspace_spec'->>'base_sha' = $6
            ) AS active_attempt
       FROM work_routing_receipts receipt
       JOIN tasks task
         ON task.id = receipt.task_id
        AND task.task_type = receipt.canonical_task_type
        AND task.payload->>'routing_receipt_id' = receipt.id::text
        AND task.payload->>'work_kind' = receipt.work_kind
        AND task.payload->>'change_kind' = receipt.change_kind
        AND task.payload->>'repo' = receipt.repo
        AND task.payload->>'harness_runtime' = 'kernel-v1'
       JOIN initiative_runs run
         ON run.id = $4
        AND run.current_task_id = receipt.task_id
        AND run.orchestrator_version = 'v2'
        AND run.phase NOT IN ('done', 'failed')
      WHERE receipt.id = $1
        AND receipt.task_id = $2
        AND receipt.repo = $3
        AND receipt.work_kind = 'coding_mutation'
        AND receipt.change_kind IN ('new_capability','capability_change','bugfix','parameter_only')
        AND receipt.pipeline = 'harness'
        AND receipt.canonical_task_type = 'harness_initiative'
        AND receipt.impact_contract_required = true
        AND receipt.orchestrator = 'kernel-harness-v2'
        AND receipt.router_version = 'work-router-v1'
        AND jsonb_typeof(receipt.map_scope) = 'array'
        AND run.deadline_at > NOW()`,
    [routing_receipt_id, task_id, repo, run_id, branch, base_sha],
  );
  const receipt = result.rows[0];
  if (!receipt) {
    return { status: 404, body: { valid: false, reason_code: 'route_violation' } };
  }
  if (receipt.superseded) {
    return { status: 409, body: { valid: false, reason_code: 'receipt_superseded' } };
  }
  if (!receipt.active_attempt) {
    return { status: 409, body: { valid: false, reason_code: 'run_attempt_inactive' } };
  }
  return {
    status: 200,
    body: {
      valid: true,
      routing_receipt_id: receipt.id,
      expires_at: receipt.expires_at,
    },
  };
}

const router = Router();
router.post('/validate', async (req, res, next) => {
  try {
    const result = await validateWorkRoutingIdentity(pool, req.body);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return next(error);
  }
});

export default router;
