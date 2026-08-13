import { Router } from 'express';
import pool from '../db.js';

const router = Router();
router.post('/validate', async (req, res) => {
  const { routing_receipt_id, task_id, run_id, repo, branch, base_sha } = req.body || {};
  if (![routing_receipt_id, task_id, run_id, repo, branch, base_sha].every(Boolean)) {
    return res.status(400).json({ valid: false, reason_code: 'route_violation' });
  }
  const result = await pool.query(
    `SELECT receipt.*,
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
            ) AS active_attempt
       FROM work_routing_receipts receipt
       JOIN initiative_runs run
         ON run.id = $4
        AND run.current_task_id = receipt.task_id
        AND run.orchestrator_version = 'v2'
        AND run.phase NOT IN ('done', 'failed')
      WHERE receipt.id = $1
        AND receipt.task_id = $2
        AND receipt.repo = $3
        AND receipt.work_kind = 'coding_mutation'
        AND receipt.pipeline = 'harness'
        AND receipt.evidence->>'branch' = $5
        AND receipt.evidence->>'base_sha' = $6
        AND run.deadline_at > NOW()`,
    [routing_receipt_id, task_id, repo, run_id, branch, base_sha],
  );
  const receipt = result.rows[0];
  if (!receipt) return res.status(404).json({ valid: false, reason_code: 'route_violation' });
  if (receipt.superseded) {
    return res.status(409).json({ valid: false, reason_code: 'receipt_superseded' });
  }
  if (!receipt.active_attempt) {
    return res.status(409).json({ valid: false, reason_code: 'run_attempt_inactive' });
  }
  return res.json({
    valid: true,
    routing_receipt_id: receipt.id,
    expires_at: receipt.expires_at,
  });
});
export default router;
