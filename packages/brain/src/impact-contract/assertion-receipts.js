const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function asObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function evidenceError(message) {
  const error = new Error(message);
  error.code = 'assertion_receipt_evidence_invalid';
  error.httpStatus = 409;
  return error;
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateCheck(assertion, check, { sourceSha, machineId }) {
  const expectedArgv = canonicalAssertionArgv(assertion.assertion_id);
  const started = Date.parse(check?.started_at);
  const completed = Date.parse(check?.completed_at);
  const cases = check?.scenario_evidence?.cases;
  const valid = check
    && check.assertion_id === assertion.assertion_id
    && JSON.stringify(check.command_argv) === JSON.stringify(expectedArgv)
    && check.journey_step_link_id === assertion.journey_step_link_id
    && check.assertion_revision === assertion.assertion_revision
    && check.assertion_digest === assertion.assertion_digest
    && check.exit_code === 0
    && DIGEST_PATTERN.test(check.output_digest ?? '')
    && typeof check.output_tail === 'string'
    && Number.isInteger(check.scenario_count)
    && check.scenario_count > 0
    && check.scenario_evidence
    && typeof check.scenario_evidence === 'object'
    && !Array.isArray(check.scenario_evidence)
    && check.scenario_evidence.pr_head_sha === sourceSha
    && check.scenario_evidence.machine === machineId
    && Array.isArray(cases)
    && cases.length === check.scenario_count
    && new Set(cases).size === cases.length
    && cases.every((item) => typeof item === 'string' && item.length > 0)
    && isCanonicalIsoTimestamp(check.started_at)
    && isCanonicalIsoTimestamp(check.completed_at)
    && completed >= started;
  if (!valid) {
    throw evidenceError(`invalid assertion evidence: ${assertion.assertion_id}`);
  }
  return { ...check, expectedArgv };
}

function sourceBindings(assertion) {
  return assertion.source_bindings ?? [{
    journey_step_link_id: assertion.journey_step_link_id,
    assertion_revision: assertion.assertion_revision,
    assertion_digest: assertion.assertion_digest,
  }];
}

export async function persistTrustedEvaluatorReceipts(db, { attempt, result }) {
  const bundle = asObject(attempt?.task_bundle);
  const inputs = asObject(bundle.inputs);
  const assertions = Array.isArray(inputs.required_assertions)
    ? inputs.required_assertions
    : [];
  if (attempt?.role !== 'evaluator' || assertions.length === 0) return [];
  const outcome = String(result?.decision?.outcome ?? '').toUpperCase();
  if (result?.status !== 'completed' || !['PASS', 'FIXED'].includes(outcome)) return [];

  const impactGate = asObject(inputs.impact_gate);
  const sourceSha = inputs.pull_request?.head_sha ?? impactGate.head_revision;
  const machineId = attempt.actual_machine_id
    ?? result.provider_metadata?.machine_id
    ?? attempt.machine_id;
  if (
    !SHA_PATTERN.test(sourceSha ?? '')
    || !impactGate.contract_id
    || !DIGEST_PATTERN.test(impactGate.contract_hash ?? '')
    || typeof impactGate.repo !== 'string'
    || !impactGate.repo.trim()
    || typeof machineId !== 'string'
    || !machineId.trim()
  ) {
    throw evidenceError('Impact Contract receipt identity is incomplete');
  }

  const checks = Array.isArray(result.checks) ? result.checks : [];
  if (
    checks.length !== assertions.length
    || new Set(checks.map((check) => check?.assertion_id)).size !== checks.length
  ) {
    throw evidenceError('assertion evidence set is not an exact bijection');
  }
  const receipts = [];
  for (const assertion of assertions) {
    const check = validateCheck(
      assertion,
      checks.find((candidate) => candidate?.assertion_id === assertion.assertion_id),
      { sourceSha, machineId },
    );
    for (const binding of sourceBindings(assertion)) {
      const receiptResult = await db.query(
      `WITH signed_gp AS (
         SELECT gpc.id AS gp_contract_id, gpc.content_hash AS gp_contract_hash
           FROM journey_step_links l
           JOIN golden_paths gp ON gp.journey_id = l.journey_id
           JOIN golden_path_contract_versions gpc
             ON gpc.golden_path_id = gp.id AND gpc.status = 'signed'
          WHERE l.id = $1
          ORDER BY gpc.signed_at DESC NULLS LAST
          LIMIT 1
       ),
       inserted AS (
         INSERT INTO journey_assertion_receipts (
           journey_step_link_id, run_id, assertion_revision,
           assertion_ref_snapshot, assertion_digest, source_repo, source_sha,
           impact_contract_id, impact_contract_hash, harness_attempt_id, command_argv,
           scenario_count, scenario_evidence, verdict, exit_code,
           started_at, completed_at, machine_id, output_digest, output_tail,
           executor_kind, synthetic, gp_contract_id, gp_contract_hash
         )
         SELECT
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11::jsonb, $12, $13::jsonb, 'PASS', 0,
           $14, $15, $16, $17, $18, 'brain_assertion_runner', false,
           signed_gp.gp_contract_id, signed_gp.gp_contract_hash
         FROM signed_gp
         ON CONFLICT (
           run_id, journey_step_link_id, source_sha, impact_contract_hash
         ) DO NOTHING
         RETURNING *
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT * FROM journey_assertion_receipts
       WHERE run_id = $2 AND journey_step_link_id = $1
         AND source_sha = $7 AND impact_contract_hash = $9
         AND NOT EXISTS (SELECT 1 FROM inserted)
       LIMIT 1`,
      [
        binding.journey_step_link_id,
        attempt.run_id,
        binding.assertion_revision,
        assertion.assertion_id,
        binding.assertion_digest,
        impactGate.repo,
        sourceSha,
        impactGate.contract_id,
        impactGate.contract_hash,
        attempt.id,
        JSON.stringify(check.expectedArgv),
        check.scenario_count,
        JSON.stringify(check.scenario_evidence),
        check.started_at,
        check.completed_at,
        machineId,
        check.output_digest,
        String(check.output_tail ?? '').slice(-8_000),
      ],
    );
      // fail-closed：无 signed GP contract 时 signed_gp 为空 → 不落 receipt → 拒写（不静默落无绑定 PASS receipt）。
      if (!receiptResult.rows[0]) {
        throw evidenceError(
          `trusted receipt requires a signed Golden Path contract identity: ${binding.journey_step_link_id}`,
        );
      }
      receipts.push(receiptResult.rows[0]);
    }
  }
  return receipts;
}
import { canonicalAssertionArgv } from '../lib/gp-assertion-command.js';
