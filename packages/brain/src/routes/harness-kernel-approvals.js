import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { defaultPrHeadResolver } from '../orchestrator/pr-head-resolver.js';
import { reviewClassForReason } from '../orchestrator/human-review-class.js';
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

async function handleReviewDecision(req, res, { approved }) {
  if (!approved && !req.body?.approved_by && req.body?.rejected_by) {
    req.body.approved_by = req.body.rejected_by;
  }
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
      `SELECT hop, observed, detail, created_at
         FROM orchestrator_decision_log
        WHERE run_id=$1::uuid
          AND hop=$2
          AND action='effect:human_review_requested'
        LIMIT 1`,
      [runId, reviewRequestHop],
    );
    const requestRow = requestResult.rows[0];
    const requestObserved = asJson(requestRow?.observed);
    const requestDetail = asJson(requestRow?.detail);
    if (!requestRow || requestObserved.pr?.head_sha !== currentSha) {
      return res.status(409).json({ error: 'human_review_request_not_found_for_sha' });
    }
    const reviewClass = reviewClassForReason(requestDetail.review_reason);

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
            AND detail->>'review_request_hop'=$3
          LIMIT 1`,
        [runId, currentSha, String(reviewRequestHop)],
      );
      if (duplicate.rowCount > 0) {
        if (transactionOpen) {
          await client.query('ROLLBACK');
          transactionOpen = false;
        }
        return res.status(409).json({ error: 'already_decided' });
      }

      // 人审等待不消耗 8h 自动化活动预算。判重之后才补时，保证重复批准
      // 不会反复延长 deadline；与 verdict 写入处于同一事务，避免半完成。
      if (requestRow.created_at) {
        await client.query(
          `UPDATE initiative_runs
              SET deadline_at = CASE
                    WHEN deadline_at IS NULL THEN NULL
                    ELSE deadline_at + GREATEST(INTERVAL '0 seconds', NOW() - $2::timestamptz)
                  END,
                  updated_at = NOW()
            WHERE id = $1::uuid
              AND phase NOT IN ('done', 'failed')`,
          [runId, requestRow.created_at],
        );
      }

      const { rows: hopRows } = await client.query(
        'SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop FROM orchestrator_decision_log WHERE run_id=$1::uuid',
        [runId],
      );
      const decisionHop = Number(hopRows[0].next_hop);
      const decidedAt = new Date().toISOString();
      const observed = {
        pr: { head_sha: currentSha },
        review_request_hop: reviewRequestHop,
      };
      const detail = approved
        ? {
            verdict: 'APPROVED',
            approved: true,
            review_class: reviewClass,
            pr_head_sha: currentSha,
            review_request_hop: reviewRequestHop,
            approved_by: auth.approvedBy,
            approved_at: decidedAt,
          }
        : {
            verdict: 'REJECTED',
            approved: false,
            rejected: true,
            review_class: reviewClass,
            pr_head_sha: currentSha,
            review_request_hop: reviewRequestHop,
            rejected_by: auth.approvedBy,
            rejected_at: decidedAt,
          };
      await client.query(
        `INSERT INTO orchestrator_decision_log
           (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
         VALUES ($1::uuid, $2, $3::jsonb, 'review', $4, 'verdict:human_review', $5::jsonb)`,
        [
          runId,
          decisionHop,
          JSON.stringify(observed),
          approved ? 'allow' : 'deny:human_review_rejected',
          JSON.stringify(detail),
        ],
      );
      if (transactionOpen) {
        await client.query('COMMIT');
        transactionOpen = false;
      }

      const response = {
        ok: true,
        run_id: runId,
        task_id: taskId,
        pr_head_sha: currentSha,
        review_request_hop: reviewRequestHop,
        review_class: reviewClass,
      };
      if (approved) {
        response.approved_by = auth.approvedBy;
        response.approved_at = decidedAt;
      } else {
        response.rejected_by = auth.approvedBy;
        response.rejected_at = decidedAt;
      }
      return res.status(202).json(response);
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
    return res.status(500).json({ error: `kernel review decision failed: ${error.message}` });
  }
}

router.post('/:runId/approve', approvalRateLimit, (req, res) => (
  handleReviewDecision(req, res, { approved: true })
));
router.post('/:runId/reject', approvalRateLimit, (req, res) => (
  handleReviewDecision(req, res, { approved: false })
));

export default router;
