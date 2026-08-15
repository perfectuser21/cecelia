import { vi } from 'vitest';

export const RUN_ID = '51000000-0000-4000-8000-000000000051';
export const TASK_ID = '61000000-0000-4000-8000-000000000061';
export const SHA = 'a'.repeat(40);
export const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '41000000-0000-4000-8000-000000000041',
  manifest_sha256: 'b'.repeat(64),
  source_revision: SHA,
});
export const SIGNATURE = ['missing screenshot', 'stale receipt'];
export const CANONICAL_SIGNATURE = ['missing screenshot', 'stale receipt'];

export function generatorClockIntent() {
  return {
    run_id: RUN_ID,
    hop: 1,
    action: 'spawn:generator',
    observed: {},
    derived_phase: 'generate',
    gate_verdict: 'allow',
    detail: {
      reason: 'contract_approved',
      pipeline_started_at: '2026-07-23T11:00:00.000Z',
      deadline_at: '2026-07-23T12:30:00.000Z',
    },
  };
}

function asJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/** Minimal append-only PostgreSQL adapter for appendAttemptVerdict. */
export function createDecisionLog(initialRows = []) {
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

export function evaluatorAttempt(id) {
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
        contract_identity: CONTRACT_IDENTITY,
      },
    },
  };
}

export function evidenceInvalidResult(attemptId, failureSignature = SIGNATURE) {
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

export function appendEvidenceInvalidJudgeVerdict(
  log,
  attemptId,
  failureSignature = SIGNATURE,
) {
  return log.append({
    action: 'verdict:judge',
    observed: { pr_head_sha: SHA },
    derived_phase: 'evaluate',
    gate_verdict: 'deny',
    detail: {
      attempt_id: attemptId,
      verdict: 'FAIL',
      pr_head_sha: SHA,
      failure_class: 'evidence_invalid',
      failure_signature: failureSignature,
      contract_identity: CONTRACT_IDENTITY,
    },
  });
}

export function verdictOverrides(log) {
  return {
    evaluateVerdict: log.rows
      .filter((row) => row.action === 'verdict:evaluate')
      .at(-1)?.detail ?? null,
    judgeVerdict: log.rows
      .filter((row) => row.action === 'verdict:judge')
      .at(-1)?.detail ?? null,
  };
}

export function observed(log, overrides = {}) {
  return {
    run: { id: RUN_ID, phase: 'evaluate', cost_usd: 0 },
    task: { status: 'in_progress', payload: {} },
    prdExists: true,
    contract: {
      approved: true,
      id: CONTRACT_IDENTITY.contract_id,
      identity: CONTRACT_IDENTITY,
    },
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

export function makeLoop(log, currentObserved, dispatch = async () => ({ status: 'DONE' })) {
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
    impactGate: {
      beforeGenerate: vi.fn(async () => ({ gate: 'pass', stage: 'convergence-fixture' })),
      beforeEvaluate: vi.fn(async () => ({ gate: 'pass', stage: 'convergence-fixture' })),
      beforeMerge: vi.fn(async () => ({ gate: 'pass', stage: 'convergence-fixture' })),
    },
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
