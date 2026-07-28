import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import pool from '../db.js';
import { defaultPrHeadResolver } from '../orchestrator/pr-head-resolver.js';
import { reviewClassForReason } from '../orchestrator/human-review-class.js';
import { authenticateApprover } from './harness-pending-reviews.js';

const router = Router();
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validMergeReviewProof(proof, {
  taskId,
  runId,
  reviewRequestHop,
  headSha,
}) {
  const bindings = proof?.bindings;
  return proof?.schema_version === 'kernel-post-diff-risk/v1'
    && proof.policy_version === 'kernel-post-diff-risk/v1'
    && proof.human_review_required === true
    && proof.auto_eligible === false
    && ['medium', 'high'].includes(proof.risk_level)
    && Number.isFinite(Date.parse(proof.expires_at))
    && Date.parse(proof.expires_at) > Date.now()
    && bindings?.task_id === taskId
    && bindings?.run_id === runId
    && bindings?.hop === reviewRequestHop
    && REPOSITORY_PATTERN.test(bindings?.repository ?? '')
    && REPOSITORY_PATTERN.test(bindings?.head_repository ?? '')
    && typeof bindings?.head_ref === 'string'
    && bindings.head_ref.length > 0
    && bindings?.head_sha === headSha
    && REPOSITORY_PATTERN.test(bindings?.base_repository ?? '')
    && typeof bindings?.base_ref === 'string'
    && bindings.base_ref.length > 0
    && SHA_PATTERN.test(bindings?.base_sha ?? '')
    && SHA256_PATTERN.test(bindings?.diff_hash ?? '')
    && SHA256_PATTERN.test(bindings?.required_checks_digest ?? '')
    && UUID_PATTERN.test(bindings?.contract_id ?? '')
    && Number.isInteger(bindings?.contract_version)
    && bindings.contract_version > 0
    && SHA256_PATTERN.test(bindings?.contract_digest ?? '')
    && Number.isFinite(Date.parse(bindings?.contract_approved_at))
    && SHA256_PATTERN.test(bindings?.behavior_fingerprint ?? '')
    && SHA256_PATTERN.test(bindings?.capability_fingerprint ?? '')
    && SHA256_PATTERN.test(bindings?.path_surface_digest ?? '')
    && typeof bindings?.path_class === 'string'
    && bindings.path_class.length > 0;
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
    let postDiffRisk = null;
    if (reviewClass === 'merge_gate') {
      const observedRisk = asJson(requestObserved.post_diff_risk);
      const detailRisk = asJson(requestDetail.post_diff_risk);
      const requestedRisk = asJson(req.body?.post_diff_risk);
      if (
        !validMergeReviewProof(observedRisk, {
          taskId,
          runId,
          reviewRequestHop,
          headSha: currentSha,
        })
        || stableJson(observedRisk) !== stableJson(detailRisk)
        || stableJson(observedRisk) !== stableJson(requestedRisk)
      ) {
        return res.status(409).json({ error: 'stale_post_diff_risk_proof' });
      }
      postDiffRisk = observedRisk;
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
        ...(postDiffRisk ? { post_diff_risk: postDiffRisk } : {}),
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
            ...(postDiffRisk ? { post_diff_risk: postDiffRisk } : {}),
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
            ...(postDiffRisk ? { post_diff_risk: postDiffRisk } : {}),
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
