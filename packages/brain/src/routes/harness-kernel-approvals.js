import { execFileSync } from 'node:child_process';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { authenticateApprover } from './harness-pending-reviews.js';

const router = Router();
const approvalRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'kernel-reviews-approval',
  message: { error: 'approval rate limit exceeded' },
});

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

router.post('/:runId/approve', approvalRateLimit, async (req, res) => {
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

    const transactional = typeof dbPool.connect === 'function';
    const client = transactional ? await dbPool.connect() : dbPool;
    let transactionOpen = false;
    try {
      if (transactional) {
        await client.query('BEGIN');
        transactionOpen = true;
      }
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [runId],
      );
      const duplicate = await client.query(
        `SELECT 1
           FROM orchestrator_decision_log
          WHERE run_id=$1::uuid
            AND action='verdict:human_review'
            AND detail->>'pr_head_sha'=$2
          LIMIT 1`,
        [runId, currentSha],
      );
      if (duplicate.rowCount > 0) {
        if (transactionOpen) {
          await client.query('ROLLBACK');
          transactionOpen = false;
        }
        return res.status(409).json({ error: 'already_approved' });
      }

      const { rows: hopRows } = await client.query(
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
      await client.query(
        `INSERT INTO orchestrator_decision_log
           (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
         VALUES ($1::uuid, $2, $3::jsonb, 'review', $4, 'verdict:human_review', $5::jsonb)`,
        [runId, approvalHop, JSON.stringify(observed), 'allow', JSON.stringify(detail)],
      );
      if (transactionOpen) {
        await client.query('COMMIT');
        transactionOpen = false;
      }

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
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => {});
        transactionOpen = false;
      }
      throw error;
    } finally {
      if (transactional) client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: `kernel approval failed: ${error.message}` });
  }
});

export default router;
