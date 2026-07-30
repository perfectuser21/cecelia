import { describe, expect, test, vi } from 'vitest';
import { appendAttemptVerdict } from '../../../packages/brain/src/routes/harness-callback.js';
import { runLoop } from '../../../packages/brain/src/orchestrator/loop.js';

const RUN_ID = '51000000-0000-4000-8000-000000000051';
const TASK_ID = '61000000-0000-4000-8000-000000000061';
const SHA = 'a'.repeat(40);
const SIGNATURE = ['missing screenshot', 'stale receipt'];
const CANONICAL_SIGNATURE = ['missing screenshot', 'stale receipt'];

function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/**
 * Minimal append-only PostgreSQL adapter for appendAttemptVerdict.
 *
 * It deliberately does not reproduce verdict normalization or convergence
 * routing. Those remain exercised in the real callback writer and runLoop.
 */
function createDecisionLog(initialRows = []) {
  const rows = initialRows.map((row) => structuredClone(row));

  return {
    rows,
    db: {
      async query(sql, params) {
        if (!sql.includes('INSERT INTO orchestrator_decision_log')) {
          return { rows: [] };
        }
        const attemptId = params[5];
        if (rows.some((row) => row.detail?.attempt_id === attemptId)) {
          return { rows: [], rowCount: 0 };
        }
        const detail = asJson(params[4]);
        rows.push({
          run_id: params[0],
          hop: Math.max(0, ...rows.map((row) => Number(row.hop) || 0)) + 1,
          observed: asJson(params[1]),
          derived_phase: params[2],
          gate_verdict: params[3],
          action: 'verdict:evaluate',
          detail,
        });
        return { rows: [], rowCount: 1 };
      },
    },
    append(row) {
      rows.push({
        run_id: RUN_ID,
        hop: Math.max(0, ...rows.map((existing) => Number(existing.hop) || 0)) + 1,
        ...structuredClone(row),
      });
      return rows.at(-1);
    },
  };
}

function evaluatorAttempt(id) {
  return {
    id,
    run_id: RUN_ID,
    role: 'evaluator',
    task_bundle: {
      inputs: {
        pull_request: {
          url: 'https://github.com/example/repo/pull/4226',
          head_sha: SHA,
        },
      },
    },
  };
}

function evidenceInvalidResult(attemptId, failureSignature = SIGNATURE) {
  return {
    attempt_id: attemptId,
    status: 'completed',
    decision: {
      outcome: 'FAIL',
      failure_class: 'evidence_invalid',
      failure_signature: failureSignature,
      reason: 'free-form feedback must not drive convergence',
    },
    artifacts: [],
    provider_metadata: { provider: 'codex' },
  };
}

function observed(log, overrides = {}) {
  return {
    run: { id: RUN_ID, phase: 'evaluate', cost_usd: 0 },
    task: { status: 'in_progress', payload: {} },
    prdExists: true,
    contract: { approved: true, id: 'contract-1' },
    pr: {
      url: 'https://github.com/example/repo/pull/4226',
      state: 'OPEN',
      mergeStateStatus: 'BLOCKED',
      merged: false,
      head_sha: SHA,
      ci: 'pass',
    },
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: log.rows,
    authCircuit: [],
    callbackResult: null,
    ...overrides,
  };
}

function makeLoop(log, currentObserved, dispatch = async () => ({ status: 'DONE' })) {
  const failureWrites = [];
  let dispatchCount = 0;
  const dispatchSpy = vi.fn(async (action, ctx) => {
    dispatchCount++;
    return dispatch(action, ctx, dispatchCount);
  });

  const pool = {
    query: vi.fn(async (sql, params) => {
      if (sql.includes('SELECT deadline_at FROM initiative_runs')) {
        return { rows: [{ deadline_at: null }] };
      }
      if (sql.includes('effect:human_review_requested')
          && sql.includes('review_request_hop')) {
        const requests = log.rows.filter(
          (row) => row.action === 'effect:human_review_requested',
        );
        const open = [...requests].reverse().find((request) => !log.rows.some(
          (row) => row.action === 'verdict:human_review'
            && String(row.detail?.review_request_hop) === String(request.hop),
        ));
        return {
          rows: open
            ? [{
                review_request_hop: open.hop,
                review_head_sha: open.observed?.pr?.head_sha ?? null,
                observed: open.observed,
              }]
            : [],
        };
      }
      if (sql.includes("SET phase = 'failed'")) {
        failureWrites.push({ runId: params[0], reason: params[1], sql });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };

  const deps = {
    pool,
    collectGroundTruth: vi.fn(async () => {
      const value = currentObserved();
      return {
        ...value,
        decisionLog: log.rows.map((row) => structuredClone(row)),
      };
    }),
    nextHop: vi.fn(async () => (
      Math.max(0, ...log.rows.map((row) => Number(row.hop) || 0)) + 1
    )),
    appendHop: vi.fn(async (entry) => {
      log.append({
        observed: entry.observed,
        derived_phase: entry.derivedPhase,
        gate_verdict: entry.gateVerdict,
        action: entry.action,
        detail: entry.detail,
      });
    }),
    writeHeartbeat: vi.fn(async () => {}),
    dispatch: dispatchSpy,
    finalizeRun: vi.fn(async (_pool, {
      runId,
      expectedTaskId,
      outcome,
      reason,
    }) => {
      failureWrites.push({
        runId,
        taskId: expectedTaskId,
        outcome,
        reason,
      });
      return {
        changed: true,
        runId,
        taskId: expectedTaskId,
        outcome,
      };
    }),
    sleep: vi.fn(async () => {}),
    now: () => new Date('2026-07-23T12:00:00Z'),
    log: vi.fn(),
  };

  return { deps, dispatchSpy, failureWrites };
}

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
    const log = createDecisionLog();
    const firstAttempt = evaluatorAttempt('72000000-0000-4000-8000-000000000072');
    const secondAttempt = evaluatorAttempt('73000000-0000-4000-8000-000000000073');
    await appendAttemptVerdict(
      firstAttempt,
      evidenceInvalidResult(firstAttempt.id),
      log.db,
    );

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
            evaluateVerdict: log.rows
              .filter((row) => row.action === 'verdict:evaluate')
              .at(-1)?.detail ?? null,
          });
        }
        return observed(log, {
          evaluateVerdict: log.rows
            .filter((row) => row.action === 'verdict:evaluate')
            .at(-1)?.detail ?? null,
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
    const log = createDecisionLog();
    const firstAttempt = evaluatorAttempt('77000000-0000-4000-8000-000000000077');
    const secondAttempt = evaluatorAttempt('78000000-0000-4000-8000-000000000078');
    await appendAttemptVerdict(
      firstAttempt,
      evidenceInvalidResult(firstAttempt.id, null),
      log.db,
    );

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
            evaluateVerdict: log.rows
              .filter((row) => row.action === 'verdict:evaluate')
              .at(-1)?.detail ?? null,
          });
        }
        return observed(log, {
          evaluateVerdict: log.rows
            .filter((row) => row.action === 'verdict:evaluate')
            .at(-1)?.detail ?? null,
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
    const log = createDecisionLog();
    const attempts = [
      evaluatorAttempt('74000000-0000-4000-8000-000000000074'),
      evaluatorAttempt('75000000-0000-4000-8000-000000000075'),
      evaluatorAttempt('76000000-0000-4000-8000-000000000076'),
    ];

    await appendAttemptVerdict(attempts[0], evidenceInvalidResult(attempts[0].id), log.db);
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
            evaluateVerdict: log.rows
              .filter((row) => row.action === 'verdict:evaluate')
              .at(-1)?.detail ?? null,
          });
        }
        return observed(log, {
          reviewApproved: true,
          evaluateVerdict: log.rows
            .filter((row) => row.action === 'verdict:evaluate')
            .at(-1)?.detail ?? null,
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
