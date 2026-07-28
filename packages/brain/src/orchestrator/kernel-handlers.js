import { normalizeFailureSignature } from './convergence-signatures.js';
import { sha256Canonical } from '../lib/kernel-equivalence-receipts.js';

const INDEPENDENT_JUDGE_SEAM_ID = 'kernel.evaluation.independent_judge';
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INDEPENDENT_JUDGE_EFFECTS = Object.freeze({
  normal: Object.freeze({
    observed_outcome: 'confirmed',
    effect_code: 'independent_verdict_recorded',
  }),
  violation: Object.freeze({
    observed_outcome: 'denied',
    effect_code: 'self_certification_denied',
  }),
  recovery: Object.freeze({
    observed_outcome: 'recovered',
    effect_code: 'reassigned_evaluator_verdict_recorded',
  }),
});

function seamError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedOutcome(value) {
  const outcome = String(value ?? '').trim().toUpperCase();
  return outcome === 'FIXED' ? 'PASS' : outcome;
}

async function validateIndependentAttemptAuthority(ctx, attemptStore) {
  const judgeAttemptId = ctx?.attempt?.id;
  const evaluatorVerdict = ctx?.observed?.evaluateVerdict;
  const evaluatorResult = ctx?.observed?.evaluateResult;
  const evaluatorAttemptId = evaluatorVerdict?.attempt_id;
  if (
    !UUID_PATTERN.test(judgeAttemptId ?? '')
    || !UUID_PATTERN.test(evaluatorAttemptId ?? '')
    || evaluatorResult?.attempt_id !== evaluatorAttemptId
    || typeof attemptStore?.getById !== 'function'
  ) {
    return { valid: false, selfCertification: false };
  }
  if (judgeAttemptId === evaluatorAttemptId) {
    return { valid: false, selfCertification: true };
  }

  const [judgeAttempt, evaluatorAttempt] = await Promise.all([
    attemptStore.getById(judgeAttemptId),
    attemptStore.getById(evaluatorAttemptId),
  ]);
  const persistedResult = evaluatorAttempt?.result;
  const exact = (
    judgeAttempt?.id === judgeAttemptId
    && judgeAttempt.run_id === ctx.runId
    && judgeAttempt.role === 'judge'
    && evaluatorAttempt?.id === evaluatorAttemptId
    && evaluatorAttempt.run_id === ctx.runId
    && evaluatorAttempt.role === 'evaluator'
    && ['completed', 'completed_with_concerns'].includes(
      evaluatorAttempt.status,
    )
    && persistedResult?.attempt_id === evaluatorAttemptId
    && persistedResult?.contract_version === evaluatorResult.contract_version
    && normalizedOutcome(persistedResult?.decision?.outcome)
      === normalizedOutcome(evaluatorResult?.decision?.outcome)
    && normalizedOutcome(evaluatorVerdict.verdict)
      === normalizedOutcome(evaluatorResult?.decision?.outcome)
  );
  return {
    valid: exact,
    selfCertification: false,
    judgeAttempt,
    evaluatorAttempt,
  };
}

function prNumber(prUrl) {
  const value = String(prUrl ?? '').match(/\/pull\/(\d+)(?:\/|$)/)?.[1];
  return value ? Number(value) : null;
}

function evaluatorBrainResult(result) {
  if (!result) return null;
  if (Array.isArray(result.behavior_tests)) return result;
  return {
    verdict: result.decision?.outcome ?? null,
    behavior_tests: Array.isArray(result.checks) ? result.checks : [],
    judgments_written: result.judgments_written ?? result.decision?.judgments_written,
    summary: result.summary ?? null,
  };
}

async function appendJudgeVerdict(
  pool,
  ctx,
  verdict,
  feedback,
  judgeFailureClass,
  judgeFailureSignature,
) {
  const evaluateVerdict = ctx.observed.evaluateVerdict ?? {};
  const evaluatorFailureClass = evaluateVerdict.failure_class ?? null;
  // Judge classification is an independent contract field. Missing means
  // unknown and must not be silently filled from the evaluator verdict.
  const failureClass = judgeFailureClass ?? null;
  const failureSignature = normalizeFailureSignature(judgeFailureSignature);

  await pool.query(
    `INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1,
            COALESCE(MAX(hop), 0) + 1,
            $2::jsonb,
            'evaluate',
            $3,
            'verdict:judge',
            $4::jsonb
       FROM orchestrator_decision_log
      WHERE run_id = $1`,
    [
      ctx.runId,
      JSON.stringify({ pr: { head_sha: ctx.observed.pr?.head_sha ?? null } }),
      verdict === 'PASS' ? 'allow' : 'deny:judge_fail',
      JSON.stringify({
        verdict,
        pr_head_sha: ctx.observed.pr?.head_sha ?? null,
        feedback: feedback ?? null,
        failure_class: failureClass,
        ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        evaluator_failure_class: evaluatorFailureClass,
      }),
    ],
  );
}

export function createKernelHandlers(deps) {
  return Object.freeze({
    async 'spawn:judge'(ctx) {
      const evaluator = ctx.observed.evaluateVerdict ?? {};
      const evaluateResult = ctx.observed.evaluateResult ?? null;
      const attemptAuthority = await validateIndependentAttemptAuthority(
        ctx,
        deps.attemptStore,
      );
      if (attemptAuthority.selfCertification) {
        return {
          status: 'BLOCKED',
          detail: 'self-certification denied',
        };
      }
      if (!attemptAuthority.valid) {
        return {
          status: 'BLOCKED',
          detail: 'independent judge Attempt authority invalid',
        };
      }
      const brainResult = evaluatorBrainResult(evaluateResult) ?? ctx.observed.callbackResult;
      const result = await deps.judgeGate({
        agentVerdict: evaluator.verdict ?? evaluateResult?.decision?.outcome,
        agentFeedback: evaluator.feedback ?? evaluateResult?.decision?.reason ?? null,
        brainResult,
        transcript: evaluateResult?.transcript ?? ctx.observed.callbackResult?.transcript,
        worktreePath: ctx.hostWorktreePath
          ?? ctx.worktreePath
          ?? ctx.bundle.inputs.worktree_path,
        sprintDir: ctx.bundle.inputs.sprint_dir,
        taskId: ctx.taskId,
        instanceLabel: `kernel-${String(ctx.attempt.id).slice(0, 8)}`,
        promptDir: deps.promptDir,
        stageFacts: {
          current_stage: 'independent_judge',
          pr_state: ctx.observed.pr?.state ?? null,
          pr_merged: ctx.observed.pr?.merged === true,
          head_sha: ctx.observed.pr?.head_sha ?? null,
          merge_gate_approved: ctx.observed.reviewApproved === true,
        },
      }, { strict: true, dbPool: deps.pool });

      if (result.judged !== true) {
        await deps.attemptStore.complete(ctx.attempt.id, {
          contract_version: '1.0',
          attempt_id: ctx.attempt.id,
          status: 'needs_context',
          summary: 'Independent judge could not produce a grounded verdict.',
          artifacts: [],
          checks: [],
          decision: { outcome: 'needs_context', reason: result.judgeError ?? 'independent evidence unavailable' },
          error: null,
          provider_metadata: { provider: 'independent-judge', session_id: null },
        });
        return { status: 'NEEDS_CONTEXT', detail: 'independent judge did not run' };
      }

      await appendJudgeVerdict(
        deps.pool,
        ctx,
        result.verdict,
        result.feedback,
        result.failure_class ?? null,
        result.failure_signature ?? null,
      );
      const failureSignature = normalizeFailureSignature(result.failure_signature);
      await deps.attemptStore.complete(ctx.attempt.id, {
        contract_version: '1.0',
        attempt_id: ctx.attempt.id,
        status: 'completed',
        summary: result.feedback ?? `Independent judge: ${result.verdict}`,
        artifacts: [],
        checks: [],
        decision: {
          outcome: result.verdict,
          reason: 'independent judge verdict',
          ...(result.failure_class == null ? {} : { failure_class: result.failure_class }),
          ...(failureSignature == null ? {} : { failure_signature: failureSignature }),
        },
        error: null,
        provider_metadata: { provider: 'independent-judge', session_id: null },
      });
      return { status: 'DONE', detail: `judge:${result.verdict}` };
    },

    async 'wait:human_review'(ctx) {
      const url = ctx.observed.pr?.url;
      const number = prNumber(url);
      if (!number) return { status: 'BLOCKED', detail: 'human review requires a valid PR URL' };
      const payload = ctx.observed.task?.payload ?? {};
      const branch = payload.pr_branch ?? payload.branch_name ?? `pr-${number}`;
      const port = await deps.allocatePort(number, branch, payload.base_repo, deps.pool);
      const preview = deps.spawnReviewPreview(port, number);
      if (preview?.status !== 0) {
        return { status: 'BLOCKED', detail: `review preview failed: ${preview?.stderr ?? preview?.status}` };
      }
      const previewUrl = `${deps.previewOrigin ?? 'http://38.23.47.81'}:${port}`;
      await deps.notifyReview({
        task_id: ctx.taskId,
        title: ctx.observed.task?.title,
        pr_url: url,
        preview_url: previewUrl,
      });
      return { status: 'DONE', detail: `human review requested: ${previewUrl}` };
    },

    async merge_pr(ctx) {
      const pr = ctx.observed.pr;
      if (!pr?.url) return { status: 'BLOCKED', detail: 'merge requires PR URL' };
      if (
        pr.merged !== true
        && pr.state !== 'MERGED'
        && pr.mergeStateStatus === 'CONFLICTING'
      ) {
        return { status: 'BLOCKED', detail: 'PR has merge conflicts' };
      }
      if (
        pr.merged !== true
        && pr.state !== 'MERGED'
        && pr.mergeStateStatus === 'BEHIND'
      ) {
        const priorRebases = (ctx.observed.decisionLog ?? []).filter(
          (row) => row.action === 'merge_pr' && row.observed?.pr?.mergeStateStatus === 'BEHIND',
        ).length;
        if (priorRebases >= 3) return { status: 'BLOCKED', detail: 'rebase attempt cap reached' };
        return { status: 'BLOCKED', detail: 'branch update requires a new generator cycle' };
      }
      if (typeof deps.mergeEffect !== 'function') {
        return { status: 'BLOCKED', detail: 'merge effect authority unavailable' };
      }
      return deps.mergeEffect({ runId: ctx.runId, taskId: ctx.taskId });
    },

    async report(ctx) {
      const { observed } = ctx;
      const payload = observed.task?.payload ?? {};
      await deps.promote(ctx.taskId, { merged: true, pr_url: observed.pr?.url }, observed.pr?.url, deps.pool);
      const handoff = deps.buildHandoff({
        task_id: ctx.taskId,
        initiative_id: observed.run?.initiative_id,
        journey_id: payload.journey_id,
        title: observed.task?.title,
        verdict: 'PASS',
        done: ['Provider-neutral Harness gates passed and PR merged.'],
        next_steps: ['完成，无下一步'],
        artifacts: {
          pr_urls: observed.pr?.url ? [observed.pr.url] : [],
          sprint_dir: payload.sprint_dir,
          branch: payload.pr_branch,
        },
      });
      await deps.saveHandoff({ pool: deps.pool }, handoff);
      await deps.syncOkr(deps.pool, ctx.taskId, 'done');
      await deps.spawnStaging({
        pr_url: observed.pr?.url,
        pr_branch: payload.pr_branch,
        sub_task_id: ctx.taskId,
        initiative_id: observed.run?.initiative_id,
        journey_id: payload.journey_id,
        base_repo: payload.base_repo,
        project_id: payload.project_id,
      });
      await deps.cleanup(ctx.runId);

      const client = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE initiative_runs
              SET phase='done', completed_at=NOW(), updated_at=NOW()
            WHERE id=$1`,
          [ctx.runId],
        );
        await client.query(
          `UPDATE tasks
              SET status='completed', completed_at=NOW(), updated_at=NOW()
            WHERE id=$1`,
          [ctx.taskId],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      return { status: 'DONE', detail: 'report chain completed' };
    },
  });
}

export function createIndependentJudgeEquivalenceSeam({
  handlerDeps,
  effectSigner,
  judgeAuthority,
} = {}) {
  if (typeof effectSigner?.signEffectResult !== 'function') {
    throw seamError('seam_effect_signer_unavailable');
  }
  if (
    judgeAuthority?.owner_service !== INDEPENDENT_JUDGE_SEAM_ID
    || typeof judgeAuthority?.loadContext !== 'function'
    || typeof judgeAuthority?.snapshot !== 'function'
    || typeof judgeAuthority?.loadPredecessorActors !== 'function'
  ) {
    throw seamError('judge_authority_port_unavailable');
  }
  const handler = createKernelHandlers(handlerDeps)?.['spawn:judge'];
  if (typeof handler !== 'function') {
    throw seamError('judge_handler_unavailable');
  }

  return Object.freeze({
    owner_service: INDEPENDENT_JUDGE_SEAM_ID,

    async invoke({
      cell,
      grant,
      resource,
      predecessor = null,
      signal,
    }) {
      signal?.throwIfAborted();
      if (
        cell?.seam_id !== INDEPENDENT_JUDGE_SEAM_ID
        || resource?.resource_id !== grant?.resource_id
        || resource?.resource_ref !== grant?.resource_ref
      ) {
        throw seamError('judge_equivalence_resource_invalid');
      }
      const effect = INDEPENDENT_JUDGE_EFFECTS[cell.scenario];
      if (!effect) throw seamError('judge_equivalence_scenario_invalid');

      const handlerContext = await judgeAuthority.loadContext({
        cell,
        grant,
        resource: {
          resource_id: resource.resource_id,
          resource_ref: resource.resource_ref,
        },
        signal,
      });
      signal?.throwIfAborted();
      const currentEvaluatorAttemptId =
        handlerContext?.observed?.evaluateVerdict?.attempt_id;
      if (!UUID_PATTERN.test(currentEvaluatorAttemptId ?? '')) {
        throw seamError('judge_equivalence_context_invalid');
      }
      if (cell.scenario === 'recovery') {
        const predecessorActors =
          await judgeAuthority.loadPredecessorActors({
            cell,
            grant,
            predecessor,
            current_evaluator_attempt_id: currentEvaluatorAttemptId,
            signal,
          });
        signal?.throwIfAborted();
        if (
          !predecessor
          || predecessorActors?.receipt_id !== predecessor.receipt_id
          || !UUID_PATTERN.test(
            predecessorActors?.evaluator_attempt_id ?? '',
          )
          || predecessorActors.evaluator_attempt_id
            === currentEvaluatorAttemptId
        ) {
          throw seamError('judge_recovery_reassignment_unproven');
        }
      }

      const before = await judgeAuthority.snapshot({
        phase: 'before',
        cell,
        grant,
        handlerContext,
        signal,
      });
      signal?.throwIfAborted();
      const result = await handler(handlerContext);
      signal?.throwIfAborted();
      const after = await judgeAuthority.snapshot({
        phase: 'after',
        cell,
        grant,
        handlerContext,
        result,
        signal,
      });
      signal?.throwIfAborted();

      const expectedResult = cell.scenario === 'violation'
        ? result?.status === 'BLOCKED'
          && result?.detail === 'self-certification denied'
        : result?.status === 'DONE'
          && /^judge:/.test(result?.detail ?? '');
      if (!expectedResult) {
        throw seamError('judge_equivalence_outcome_unexpected');
      }

      return effectSigner.signEffectResult({
        service_id: INDEPENDENT_JUDGE_SEAM_ID,
        cell,
        grant,
        resource_id: grant.resource_id,
        resource_ref: grant.resource_ref,
        observed_outcome: effect.observed_outcome,
        effect_code: effect.effect_code,
        before_hash: sha256Canonical(before),
        after_hash: sha256Canonical(after),
        predecessor,
        signal,
      });
    },

    async cancel({ signal } = {}) {
      return { confirmed: signal?.aborted === true };
    },

    async cleanup() {
      return { confirmed: true };
    },
  });
}

export const __test__ = { prNumber, appendJudgeVerdict };
