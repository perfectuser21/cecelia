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
const contextAnswerRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'kernel-context-answer',
  message: { error: 'context answer rate limit exceeded' },
});
const contextReadRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  identifier: 'kernel-context-read',
  message: { error: 'context read rate limit exceeded' },
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
  // review_request_hop 可省略（案卷 task 31b93fd4）：Bark 审批通知在 decision-log
  // append 之前触发，那一刻真正的 hop 号还没分配，硬要求调用方带 hop 等于逼通知模板
  // 猜一个未来才确定的数。省略时按 run_id+head_sha 反查最新一条待审请求（下方 SQL 二选一）。
  const hopProvided = req.body?.review_request_hop !== undefined;
  const reviewRequestHop = hopProvided ? Number(req.body.review_request_hop) : null;
  if (!taskId || !requestedSha || (hopProvided && (!Number.isInteger(reviewRequestHop) || reviewRequestHop < 1))) {
    return res.status(400).json({
      error: 'task_id, pr_head_sha are required; review_request_hop must be a positive integer if provided',
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

    const requestResult = hopProvided
      ? await dbPool.query(
        `SELECT hop, observed, detail, created_at
           FROM orchestrator_decision_log
          WHERE run_id=$1::uuid
            AND hop=$2
            AND action='effect:human_review_requested'
          LIMIT 1`,
        [runId, reviewRequestHop],
      )
      : await dbPool.query(
        `SELECT hop, observed, detail, created_at
           FROM orchestrator_decision_log
          WHERE run_id=$1::uuid
            AND action='effect:human_review_requested'
            AND observed->'pr'->>'head_sha'=$2
          ORDER BY hop DESC
          LIMIT 1`,
        [runId, currentSha],
      );
    const requestRow = requestResult.rows[0];
    const requestObserved = asJson(requestRow?.observed);
    const requestDetail = asJson(requestRow?.detail);
    if (!requestRow || requestObserved.pr?.head_sha !== currentSha) {
      return res.status(409).json({ error: 'human_review_request_not_found_for_sha' });
    }
    const resolvedReviewRequestHop = hopProvided ? reviewRequestHop : Number(requestRow.hop);
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
        [runId, currentSha, String(resolvedReviewRequestHop)],
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
        review_request_hop: resolvedReviewRequestHop,
      };
      const detail = approved
        ? {
            verdict: 'APPROVED',
            approved: true,
            review_class: reviewClass,
            pr_head_sha: currentSha,
            review_request_hop: resolvedReviewRequestHop,
            approved_by: auth.approvedBy,
            approved_at: decidedAt,
          }
        : {
            verdict: 'REJECTED',
            approved: false,
            rejected: true,
            review_class: reviewClass,
            pr_head_sha: currentSha,
            review_request_hop: resolvedReviewRequestHop,
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
        review_request_hop: resolvedReviewRequestHop,
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

async function handleContextAnswer(req, res) {
  const auth = authenticateApprover(req, res);
  if (!auth.ok) return;

  const { runId } = req.params;
  const taskId = typeof req.body?.task_id === 'string' ? req.body.task_id.trim() : '';
  const contextRequestHop = Number(req.body?.context_request_hop);
  const contextVersion = typeof req.body?.context_version === 'string'
    ? req.body.context_version.trim()
    : '';
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  if (
    !taskId
    || !Number.isInteger(contextRequestHop)
    || contextRequestHop < 1
    || !contextVersion
    || !answer
    || answer.length > 8_000
  ) {
    return res.status(400).json({
      error: 'task_id, positive context_request_hop, context_version and answer are required',
    });
  }

  const dbPool = req.app.get('pool') || pool;
  try {
    const requestResult = await dbPool.query(
      `SELECT r.id AS run_id,
              r.phase,
              t.id AS task_id,
              request.hop AS context_request_hop,
              request.detail,
              request.created_at
         FROM initiative_runs r
         JOIN tasks t ON t.id=r.current_task_id
         JOIN orchestrator_decision_log request
           ON request.run_id=r.id
          AND request.hop=$3
          AND request.action='effect:context_requested'
        WHERE r.id=$1::uuid
          AND t.id=$2::uuid`,
      [runId, taskId, contextRequestHop],
    );
    const requestRow = requestResult.rows[0];
    if (!requestRow) {
      return res.status(404).json({ error: 'context request not found for run/task' });
    }
    const requestDetail = asJson(requestRow.detail);
    if (requestDetail.context_version !== contextVersion) {
      return res.status(409).json({ error: 'stale_context_version' });
    }
    const resumePhase = requestDetail.resume_phase;
    if (!['planning', 'gan', 'generate', 'evaluate', 'review', 'merge'].includes(resumePhase)) {
      return res.status(409).json({ error: 'context_resume_phase_invalid' });
    }

    const client = await dbPool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text))',
        [runId],
      );
      const duplicate = await client.query(
        `SELECT detail
           FROM orchestrator_decision_log
          WHERE run_id=$1::uuid
            AND action='verdict:context_answer'
            AND detail->>'context_request_hop'=$2
          LIMIT 1`,
        [runId, String(contextRequestHop)],
      );
      if (duplicate.rowCount > 0) {
        const prior = asJson(duplicate.rows[0].detail);
        await client.query('ROLLBACK');
        transactionOpen = false;
        if (
          prior.context_version === contextVersion
          && prior.answer === answer
          && prior.answered_by === auth.approvedBy
        ) {
          return res.status(200).json({
            ok: true,
            deduped: true,
            run_id: runId,
            task_id: taskId,
            context_request_hop: contextRequestHop,
            context_version: contextVersion,
          });
        }
        return res.status(409).json({ error: 'context_request_already_answered' });
      }

      const currentRun = await client.query(
        `SELECT phase
           FROM initiative_runs
          WHERE id=$1::uuid
            AND current_task_id=$2::uuid`,
        [runId, taskId],
      );
      if (currentRun.rows[0]?.phase !== 'paused') {
        await client.query('ROLLBACK');
        transactionOpen = false;
        return res.status(409).json({ error: 'run_not_paused' });
      }

      const { rows: hopRows } = await client.query(
        'SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop FROM orchestrator_decision_log WHERE run_id=$1::uuid',
        [runId],
      );
      const answerHop = Number(hopRows[0].next_hop);
      const answeredAt = new Date().toISOString();
      const detail = {
        callback_hop: Number(requestDetail.callback_hop),
        context_request_hop: contextRequestHop,
        context_version: contextVersion,
        answer,
        answered_by: auth.approvedBy,
        answered_at: answeredAt,
      };
      await client.query(
        `INSERT INTO orchestrator_decision_log
           (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
         VALUES (
           $1::uuid, $2, $3::jsonb, 'paused', 'allow',
           'verdict:context_answer', $4::jsonb
         )
         RETURNING hop`,
        [
          runId,
          answerHop,
          JSON.stringify({
            callback_hop: detail.callback_hop,
            context_request_hop: contextRequestHop,
            context_version: contextVersion,
          }),
          JSON.stringify(detail),
        ],
      );
      const reopened = await client.query(
        `UPDATE initiative_runs
            SET deadline_at=CASE
                  WHEN deadline_at IS NULL THEN NULL
                  ELSE deadline_at + GREATEST(
                    INTERVAL '0 seconds',
                    NOW() - $2::timestamptz
                  )
                END,
                updated_at=NOW()
          WHERE id=$1::uuid
            AND phase='paused'
          RETURNING id`,
        [runId, requestRow.created_at ?? new Date().toISOString()],
      );
      if (reopened.rowCount !== 1) {
        throw new Error('paused run changed before context answer commit');
      }
      await client.query(
        `UPDATE tasks
            SET updated_at=NOW()
          WHERE id=$1::uuid
            AND status='in_progress'`,
        [taskId],
      );
      await client.query('COMMIT');
      transactionOpen = false;
      return res.status(202).json({
        ok: true,
        deduped: false,
        run_id: runId,
        task_id: taskId,
        context_request_hop: contextRequestHop,
        context_version: contextVersion,
        answered_by: auth.approvedBy,
        answered_at: answeredAt,
        resume_pending: true,
        resume_phase: resumePhase,
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query('ROLLBACK').catch(() => {});
        transactionOpen = false;
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return res.status(500).json({ error: `kernel context answer failed: ${error.message}` });
  }
}

router.get('/contexts', contextReadRateLimit, async (req, res) => {
  const dbPool = req.app.get('pool') || pool;
  try {
    const { rows } = await dbPool.query(
      `SELECT r.id AS run_id,
              r.current_task_id AS task_id,
              t.title AS task_title,
              request.hop AS context_request_hop,
              request.detail,
              request.created_at
         FROM initiative_runs r
         JOIN tasks t ON t.id=r.current_task_id
         JOIN orchestrator_decision_log request
           ON request.run_id=r.id
          AND request.action='effect:context_requested'
        WHERE r.phase='paused'
          AND NOT EXISTS (
            SELECT 1
              FROM orchestrator_decision_log answer
             WHERE answer.run_id=request.run_id
               AND answer.action='verdict:context_answer'
               AND answer.detail->>'context_request_hop'=request.hop::text
          )
        ORDER BY request.created_at ASC, request.hop ASC
        LIMIT 50`,
    );
    return res.json({
      contexts: rows.map((row) => {
        const detail = asJson(row.detail);
        return {
          run_id: row.run_id,
          task_id: row.task_id,
          task_title: row.task_title,
          context_request_hop: Number(row.context_request_hop),
          context_version: detail.context_version ?? null,
          callback_hop: Number(detail.callback_hop),
          question: detail.question ?? null,
          created_at: row.created_at,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({ error: `kernel context list failed: ${error.message}` });
  }
});

router.post('/:runId/approve', approvalRateLimit, (req, res) => (
  handleReviewDecision(req, res, { approved: true })
));
router.post('/:runId/reject', approvalRateLimit, (req, res) => (
  handleReviewDecision(req, res, { approved: false })
));
router.post('/:runId/context', contextAnswerRateLimit, handleContextAnswer);

export default router;
