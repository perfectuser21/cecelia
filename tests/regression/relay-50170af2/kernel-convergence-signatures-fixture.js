export const RUN_ID = '51000000-0000-4000-8000-000000000051';
export const SHA = 'a'.repeat(40);
export const CONTRACT_IDENTITY = Object.freeze({
  contract_id: '41000000-0000-4000-8000-000000000041',
  manifest_sha256: 'b'.repeat(64),
  source_revision: SHA,
});
export const SIGNATURE = ['missing screenshot', 'stale receipt'];
export const CANONICAL_SIGNATURE = ['missing screenshot', 'stale receipt'];

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
