import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import pool from '../db.js';
import { authenticateApprover } from './harness-pending-reviews.js';

const router = Router();

function asJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function defaultPrHeadResolver(prUrl) {
  const output = execFileSync(
    'gh',
    ['pr', 'view', prUrl, '--json', 'headRefOid'],
    { encoding: 'utf8', timeout: 15_000 },
  );
  return JSON.parse(output).headRefOid ?? null;
}

router.post('/:runId/approve', async (req, res) => {
  const auth = authenticateApprover(req, res);
  if (!auth.ok) return;

  const { runId } = req.params;
  const taskId = typeof req.body?.task_id === 'string' ? req.body.task_id.trim() : '';
  const requestedSha = typeof req.body?.pr_head_sha === 'string'
    ? req.body.pr_head_sha.trim()
    : '';
  const reviewRequestHop = Number(req.body?.review_request_hop);
  if (!taskId || !requestedSha || !Number.isInteger(reviewRequestHop) || reviewRequestHop < 1) {
    return res.status(400).json({
      error: 'task_id, pr_head_sha and positive review_request_hop are required',
    });
  }

  const dbPool = req.app.get('pool') || pool;
  const resolver = req.app.get('kernelPrHeadResolver') || defaultPrHeadResolver;
  try {
    const runResult = await dbPool.query(
      `SELECT r.id AS run_id, t.id AS task_id, r.pr_url
         FROM initiative_runs r
         JOIN tasks t ON t.id = r.current_task_id
        WHERE r.id=$1::uuid AND t.id=$2::uuid`,
      [runId, taskId],
    );
    const run = runResult.rows[0];
    if (!run) return res.status(404).json({ error: 'kernel run/task not found' });
    if (!run.pr_url) return res.status(409).json({ error: 'run has no pull request' });

    const currentSha = await resolver(run.pr_url);
    if (!currentSha) return res.status(409).json({ error: 'current PR head unavailable' });
    if (requestedSha !== currentSha) {
      return res.status(409).json({
        error: 'stale_sha',
        current_pr_head_sha: currentSha,
      });
    }

    const requestResult = await dbPool.query(
      `SELECT hop, observed, detail
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
          AND hop=$2
          AND action='effect:human_review_requested'
        LIMIT 1`,
      [runId, reviewRequestHop],
    );
    const requestRow = requestResult.rows[0];
    const requestObserved = asJson(requestRow?.observed);
    if (!requestRow || requestObserved.pr?.head_sha !== currentSha) {
      return res.status(409).json({ error: 'human_review_request_not_found_for_sha' });
    }

    const duplicate = await dbPool.query(
      `SELECT 1
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid AND action='verdict:human_review'
        LIMIT 1`,
      [runId],
    );
    if (duplicate.rowCount > 0) {
      return res.status(409).json({ error: 'already_approved' });
    }

    const { rows: hopRows } = await dbPool.query(
      'SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop FROM orchestrator_decision_log WHERE run_id=$1::uuid',
      [runId],
    );
    const approvalHop = Number(hopRows[0].next_hop);
    const approvedAt = new Date().toISOString();
    const observed = {
      pr: { head_sha: currentSha },
      review_request_hop: reviewRequestHop,
    };
    const detail = {
      verdict: 'APPROVED',
      approved: true,
      pr_head_sha: currentSha,
      review_request_hop: reviewRequestHop,
      approved_by: auth.approvedBy,
      approved_at: approvedAt,
    };
    await dbPool.query(
      `INSERT INTO orchestrator_decision_log
         (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
       VALUES ($1::uuid, $2, $3::jsonb, 'review', $4, 'verdict:human_review', $5::jsonb)`,
      [runId, approvalHop, JSON.stringify(observed), 'allow', JSON.stringify(detail)],
    );

    return res.status(202).json({
      ok: true,
      run_id: runId,
      task_id: taskId,
      pr_head_sha: currentSha,
      review_request_hop: reviewRequestHop,
      approved_by: auth.approvedBy,
      approved_at: approvedAt,
    });
  } catch (error) {
    return res.status(500).json({ error: `kernel approval failed: ${error.message}` });
  }
});

export default router;
