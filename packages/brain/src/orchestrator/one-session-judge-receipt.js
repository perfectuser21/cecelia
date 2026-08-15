const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function sameIdentity(left, right) {
  return left?.contract_id === right?.contract_id
    && left?.manifest_sha256 === right?.manifest_sha256
    && left?.source_revision === right?.source_revision;
}

function assertInput(input) {
  if (!UUID_PATTERN.test(input?.runId ?? '') || !UUID_PATTERN.test(input?.taskId ?? '')) {
    throw conflict('one_session_receipt_identity_invalid');
  }
  if (
    !UUID_PATTERN.test(input?.contractIdentity?.contract_id ?? '')
    || !DIGEST_PATTERN.test(input?.contractIdentity?.manifest_sha256 ?? '')
    || !SHA_PATTERN.test(input?.contractIdentity?.source_revision ?? '')
    || !SHA_PATTERN.test(input?.prHeadSha ?? '')
    || !DIGEST_PATTERN.test(input?.evaluatorEvidenceSha256 ?? '')
  ) {
    throw conflict('one_session_receipt_authority_invalid');
  }
  if (!['PASS', 'FAIL'].includes(input?.evaluatorVerdict)) {
    throw conflict('one_session_evaluator_verdict_invalid');
  }
  if (
    input?.judgeResult?.judged !== true
    || !['PASS', 'FAIL'].includes(input.judgeResult.verdict)
  ) {
    throw conflict('one_session_judge_verdict_invalid');
  }
}

async function appendVerdict(client, {
  runId,
  action,
  gateVerdict,
  detail,
}) {
  await client.query(
    `INSERT INTO orchestrator_decision_log
       (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
     SELECT $1,
            COALESCE(MAX(hop), 0) + 1,
            $2::jsonb,
            'evaluate',
            $3,
            $4,
            $5::jsonb
       FROM orchestrator_decision_log
      WHERE run_id=$1`,
    [
      runId,
      JSON.stringify({ source: 'one_session_judge_api' }),
      gateVerdict,
      action,
      JSON.stringify(detail),
    ],
  );
}

export async function persistOneSessionJudgeReceipt(pool, input) {
  assertInput(input);
  if (typeof pool?.connect !== 'function') {
    throw new Error('one_session_receipt_transaction_client_required');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query(
      'SELECT id FROM tasks WHERE id=$1 FOR UPDATE',
      [input.taskId],
    );
    if (task.rows.length !== 1) throw conflict('one_session_task_authority_missing');

    const run = await client.query(
      `SELECT id, contract_id
         FROM initiative_runs
        WHERE id=$1
          AND current_task_id=$2
          AND orchestrator_version='v2'
          AND record_trust_status IN ('trusted','reconstructed')
          AND phase NOT IN ('done','failed')
        FOR UPDATE`,
      [input.runId, input.taskId],
    );
    if (run.rows.length !== 1) throw conflict('one_session_run_authority_missing');
    if (run.rows[0].contract_id !== input.contractIdentity.contract_id) {
      throw conflict('one_session_contract_identity_changed');
    }

    const seal = await client.query(
      `SELECT seal.contract_id, seal.manifest_sha256, seal.source_revision
         FROM initiative_contract_artifact_seals AS seal
         JOIN initiative_contracts AS contract ON contract.id=seal.contract_id
        WHERE seal.contract_id=$1
          AND contract.status='approved'`,
      [input.contractIdentity.contract_id],
    );
    const storedIdentity = seal.rows[0] ?? null;
    if (!sameIdentity(storedIdentity, input.contractIdentity)) {
      throw conflict('one_session_contract_identity_changed');
    }

    const existing = await client.query(
      `SELECT hop
         FROM orchestrator_decision_log
        WHERE run_id=$1
          AND action='verdict:judge'
          AND detail->>'source' = 'one_session_judge_api'
          AND detail->>'pr_head_sha'=$2
          AND detail->'contract_identity'=$3::jsonb
        ORDER BY hop DESC
        LIMIT 1`,
      [input.runId, input.prHeadSha, JSON.stringify(input.contractIdentity)],
    );
    if (existing.rows.length === 1) {
      await client.query('COMMIT');
      return Object.freeze({
        persisted: false,
        existing_hop: Number(existing.rows[0].hop),
        contract_identity: input.contractIdentity,
      });
    }

    const evaluatorDetail = {
      source: 'one_session_judge_api',
      verdict: input.evaluatorVerdict,
      pr_head_sha: input.prHeadSha,
      contract_identity: input.contractIdentity,
      evaluator_evidence_sha256: input.evaluatorEvidenceSha256,
      feedback: input.evaluatorFeedback ?? null,
    };
    await appendVerdict(client, {
      runId: input.runId,
      action: 'verdict:evaluate',
      gateVerdict: input.evaluatorVerdict === 'PASS' ? 'allow' : 'deny:evaluate_fail',
      detail: evaluatorDetail,
    });

    const judgeDetail = {
      source: 'one_session_judge_api',
      verdict: input.judgeResult.verdict,
      pr_head_sha: input.prHeadSha,
      contract_identity: input.contractIdentity,
      feedback: input.judgeResult.feedback ?? null,
      failure_class: input.judgeResult.failure_class ?? null,
      failure_signature: input.judgeResult.failure_signature ?? null,
      coverage: input.judgeResult.coverage ?? [],
      evaluator_evidence_sha256: input.evaluatorEvidenceSha256,
    };
    await appendVerdict(client, {
      runId: input.runId,
      action: 'verdict:judge',
      gateVerdict: input.judgeResult.verdict === 'PASS' ? 'allow' : 'deny:judge_fail',
      detail: judgeDetail,
    });
    await client.query('COMMIT');
    return Object.freeze({
      persisted: true,
      contract_identity: input.contractIdentity,
      pr_head_sha: input.prHeadSha,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    throw error;
  } finally {
    client.release();
  }
}
