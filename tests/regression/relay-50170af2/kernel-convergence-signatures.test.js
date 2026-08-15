import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';
import { appendAttemptVerdict } from '../../../packages/brain/src/routes/harness-callback.js';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';
import {
  CANONICAL_SIGNATURE,
  RUN_ID,
  SHA,
  TASK_ID,
  appendEvidenceInvalidJudgeVerdict,
  createDecisionLog,
  evaluatorAttempt,
  evidenceInvalidResult,
  generatorClockIntent,
  makeLoop,
  observed,
  verdictOverrides,
} from './kernel-convergence-signatures-fixture.js';

describe('R5/R6 structured convergence signatures', () => {
  test('evaluator callback canonicalizes a structured failure_signature and ignores feedback text', async () => {
    const log = createDecisionLog();
    const attempt = evaluatorAttempt('71000000-0000-4000-8000-000000000071');

    await appendAttemptVerdict(
      attempt,
      evidenceInvalidResult(attempt.id, [
        ' stale receipt ',
        'missing screenshot',
        'stale receipt',
      ]),
      log.db,
    );

    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({
      action: 'verdict:evaluate',
      detail: {
        failure_class: 'evidence_invalid',
        failure_signature: CANONICAL_SIGNATURE,
      },
    });
    expect(log.rows[0].detail).not.toHaveProperty('failure_signature_text');
  });

  test('R5: a second no-PR generator crash with the same server signature fails the run', async () => {
    const log = createDecisionLog();
    const crash = {
      code: 1,
      auth_failed: false,
      action: 'spawn:generator-fix',
      role: 'generator',
      error_code: 'provider_failed',
      failure_class: 'runtime_crash',
    };
    const crashSignature = {
      role: 'generator',
      error_code: 'provider_failed',
      failure_class: 'runtime_crash',
    };
    const { deps, dispatchSpy, failureWrites } = makeLoop(
      log,
      () => {
        const fixIntents = log.rows.filter((row) => row.action === 'spawn:generator-fix');
        if (fixIntents.length >= 2) {
          return observed(log, {
            run: { id: RUN_ID, phase: 'done', cost_usd: 0 },
            pr: null,
            lastAgentExit: crash,
          });
        }
        return observed(log, { pr: null, lastAgentExit: crash });
      },
    );

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(log.rows.find((row) => row.action === 'spawn:generator-fix')?.observed)
      .toMatchObject({ crash_signature: crashSignature });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      exitReason: 'repeated_generator_crash_signature',
    });
    expect(failureWrites).toEqual([
      expect.objectContaining({
        runId: RUN_ID,
        reason: 'repeated_generator_crash_signature',
      }),
    ]);
  });

  test('R6: the second identical evidence_invalid signature pauses for human review and records replay evidence', async () => {
    const log = createDecisionLog([generatorClockIntent()]);
    const firstAttempt = evaluatorAttempt('72000000-0000-4000-8000-000000000072');
    const secondAttempt = evaluatorAttempt('73000000-0000-4000-8000-000000000073');
    await appendAttemptVerdict(
      firstAttempt,
      evidenceInvalidResult(firstAttempt.id),
      log.db,
    );
    appendEvidenceInvalidJudgeVerdict(log, randomUUID(), CANONICAL_SIGNATURE);

    const { deps, dispatchSpy, failureWrites } = makeLoop(
      log,
      () => {
        const reviewEffect = log.rows.find(
          (row) => row.action === 'effect:human_review_requested',
        );
        const repairIntents = log.rows.filter(
          (row) => row.action === 'spawn:evaluator-evidence-repair',
        );
        // Bound the old implementation: it must fail assertions instead of
        // consuming the 4096-hop safety fence.
        if (reviewEffect || repairIntents.length >= 2) {
          return observed(log, {
            run: { id: RUN_ID, phase: 'done', cost_usd: 0 },
            ...verdictOverrides(log),
          });
        }
        return observed(log, {
          ...verdictOverrides(log),
        });
      },
      async (action) => {
        if (action === 'spawn:evaluator-evidence-repair') {
          const attempts = log.rows.filter(
            (row) => row.action === 'verdict:evaluate',
          );
          if (attempts.length === 1) {
            await appendAttemptVerdict(
              secondAttempt,
              evidenceInvalidResult(secondAttempt.id, [
                'stale receipt',
                ' missing screenshot ',
              ]),
              log.db,
            );
            appendEvidenceInvalidJudgeVerdict(log, randomUUID(), CANONICAL_SIGNATURE);
          }
        }
        return { status: 'DONE', detail: 'notified' };
      },
    );

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    const repairIntent = log.rows.find(
      (row) => row.action === 'spawn:evaluator-evidence-repair',
    );
    expect(repairIntent?.observed).toMatchObject({
      failure_class: 'evidence_invalid',
      failure_signature: CANONICAL_SIGNATURE,
    });

    const reviewIntent = log.rows.find((row) => row.action === 'wait:human_review');
    expect(reviewIntent?.detail).toMatchObject({
      reason: 'evidence_invalid:repeated_signature',
    });

    const reviewEffect = log.rows.find(
      (row) => row.action === 'effect:human_review_requested',
    );
    expect(reviewEffect?.detail).toMatchObject({
      review_reason: 'evidence_invalid:repeated_signature',
      failure_signature: CANONICAL_SIGNATURE,
    });
    expect(
      dispatchSpy.mock.calls.filter(([action]) => (
        action === 'spawn:evaluator-evidence-repair'
      )),
    ).toHaveLength(1);
    expect(failureWrites).toEqual([]);
  });

  test('R6: a second unsigned evidence_invalid verdict routes to unknown human review', async () => {
    const log = createDecisionLog([generatorClockIntent()]);
    const firstAttempt = evaluatorAttempt('77000000-0000-4000-8000-000000000077');
    const secondAttempt = evaluatorAttempt('78000000-0000-4000-8000-000000000078');
    await appendAttemptVerdict(
      firstAttempt,
      evidenceInvalidResult(firstAttempt.id, null),
      log.db,
    );
    appendEvidenceInvalidJudgeVerdict(log, randomUUID(), null);

    const { deps, dispatchSpy, failureWrites } = makeLoop(
      log,
      () => {
        const reviewEffect = log.rows.find(
          (row) => row.action === 'effect:human_review_requested',
        );
        const repairIntents = log.rows.filter(
          (row) => row.action === 'spawn:evaluator-evidence-repair',
        );
        if (reviewEffect || repairIntents.length >= 2) {
          return observed(log, {
            run: { id: RUN_ID, phase: 'done', cost_usd: 0 },
            ...verdictOverrides(log),
          });
        }
        return observed(log, {
          ...verdictOverrides(log),
        });
      },
      async (action) => {
        if (
          action === 'spawn:evaluator-evidence-repair'
          && log.rows.filter((row) => row.action === 'verdict:evaluate').length === 1
        ) {
          await appendAttemptVerdict(
            secondAttempt,
            evidenceInvalidResult(secondAttempt.id, null),
            log.db,
          );
          appendEvidenceInvalidJudgeVerdict(log, randomUUID(), null);
        }
        return { status: 'DONE', detail: 'notified' };
      },
    );

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(dispatchSpy.mock.calls.filter(
      ([action]) => action === 'spawn:evaluator-evidence-repair',
    )).toHaveLength(1);
    expect(log.rows.find(
      (row) => row.action === 'effect:human_review_requested',
    )?.detail).toMatchObject({
      review_reason: 'unknown:missing_failure_signature',
    });
    expect(failureWrites).toEqual([]);
  });

  test('R6: after approval, one more unchanged evidence signature fails without a second review', async () => {
    const log = createDecisionLog([generatorClockIntent()]);
    const attempts = [
      evaluatorAttempt('74000000-0000-4000-8000-000000000074'),
      evaluatorAttempt('75000000-0000-4000-8000-000000000075'),
      evaluatorAttempt('76000000-0000-4000-8000-000000000076'),
    ];

    await appendAttemptVerdict(attempts[0], evidenceInvalidResult(attempts[0].id), log.db);
    appendEvidenceInvalidJudgeVerdict(log, randomUUID(), CANONICAL_SIGNATURE);
    log.append({
      action: 'spawn:evaluator-evidence-repair',
      observed: {
        pr: { head_sha: SHA },
        failure_class: 'evidence_invalid',
        failure_signature: CANONICAL_SIGNATURE,
      },
      detail: { reason: 'evidence_invalid' },
    });
    await appendAttemptVerdict(attempts[1], evidenceInvalidResult(attempts[1].id), log.db);
    appendEvidenceInvalidJudgeVerdict(log, randomUUID(), CANONICAL_SIGNATURE);
    log.append({
      action: 'wait:human_review',
      observed: {
        pr: { head_sha: SHA },
        failure_class: 'evidence_invalid',
        failure_signature: CANONICAL_SIGNATURE,
      },
      detail: { reason: 'evidence_invalid:repeated_signature' },
    });
    const request = log.append({
      action: 'effect:human_review_requested',
      observed: {
        pr: { head_sha: SHA },
        failure_class: 'evidence_invalid',
        failure_signature: CANONICAL_SIGNATURE,
      },
      detail: {
        review_reason: 'evidence_invalid:repeated_signature',
        failure_signature: CANONICAL_SIGNATURE,
      },
    });
    log.append({
      action: 'verdict:human_review',
      observed: { pr_head_sha: SHA },
      detail: {
        approved: true,
        pr_head_sha: SHA,
        review_request_hop: String(request.hop),
      },
    });

    const initialReviewCount = log.rows.filter(
      (row) => row.action === 'wait:human_review',
    ).length;
    const { deps, dispatchSpy, failureWrites } = makeLoop(
      log,
      () => {
        // Bound the old implementation after it wrongly dispatches a second
        // post-approval repair. The intended implementation fails before that
        // second dispatch.
        if (dispatchSpy.mock.calls.length >= 2) {
          return observed(log, {
            run: { id: RUN_ID, phase: 'done', cost_usd: 0 },
            ...verdictOverrides(log),
          });
        }
        return observed(log, {
          reviewApproved: true,
          ...verdictOverrides(log),
        });
      },
      async (action) => {
        if (action === 'spawn:evaluator-evidence-repair'
            && !log.rows.some((row) => row.detail?.attempt_id === attempts[2].id)) {
          await appendAttemptVerdict(
            attempts[2],
            evidenceInvalidResult(attempts[2].id),
            log.db,
          );
          appendEvidenceInvalidJudgeVerdict(log, randomUUID(), CANONICAL_SIGNATURE);
        }
        return { status: 'DONE', detail: 'post-approval observation' };
      },
    );

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result).toMatchObject({
      exitReason: 'repeated_evidence_invalid_after_approval',
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      'spawn:evaluator-evidence-repair',
      expect.objectContaining({ runId: RUN_ID }),
    );
    expect(log.rows.filter((row) => row.action === 'wait:human_review'))
      .toHaveLength(initialReviewCount);
    expect(failureWrites).toEqual([
      expect.objectContaining({
        reason: 'repeated_evidence_invalid_after_approval',
      }),
    ]);
  });
});
