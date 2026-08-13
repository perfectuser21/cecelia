const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const validatedChecks = new Map(assertions.map((assertion) => [
    assertion.assertion_id,
    validateCheck(
      assertion,
      checks.find((candidate) => candidate?.assertion_id === assertion.assertion_id),
      { sourceSha, machineId },
    ),
  ]));

  const gpContract = asObject(inputs.gp_contract);
  const hasGpContract = Object.keys(gpContract).length > 0;
  let gpContractId = null;
  let gpContractHash = null;
  if (hasGpContract) {
    const validIdentity = UUID_PATTERN.test(gpContract.id ?? '')
      && Number.isInteger(Number(gpContract.version))
      && Number(gpContract.version) > 0
      && DIGEST_PATTERN.test(gpContract.hash ?? '')
      && UUID_PATTERN.test(gpContract.golden_path_id ?? '')
      && UUID_PATTERN.test(gpContract.journey_id ?? '')
      && UUID_PATTERN.test(gpContract.step_id ?? '');
    if (!validIdentity) throw evidenceError('GP Contract receipt identity is incomplete');
    const signedContract = await db.query(
      `SELECT v.id
         FROM golden_path_contract_versions v
         JOIN golden_paths gp ON gp.id = v.golden_path_id
        WHERE v.id = $1 AND v.version = $2 AND v.content_hash = $3
          AND v.status = 'signed' AND v.golden_path_id = $4
          AND gp.journey_id = $5
        LIMIT 1`,
      [
        gpContract.id,
        Number(gpContract.version),
        gpContract.hash,
        gpContract.golden_path_id,
        gpContract.journey_id,
      ],
    );
    if (signedContract.rows.length !== 1) {
      throw evidenceError('GP Contract receipt identity does not match signed SSOT');
    }
    gpContractId = gpContract.id;
    gpContractHash = gpContract.hash;
  }

  const receipts = [];
  for (const assertion of assertions) {
    const check = validatedChecks.get(assertion.assertion_id);
    for (const binding of sourceBindings(assertion)) {
      const receiptResult = await db.query(
      `WITH inserted AS (
         INSERT INTO journey_assertion_receipts (
           journey_step_link_id, run_id, assertion_revision,
           assertion_ref_snapshot, assertion_digest, source_repo, source_sha,
           gp_contract_id, gp_contract_hash,
           impact_contract_id, impact_contract_hash, harness_attempt_id, command_argv,
           scenario_count, scenario_evidence, verdict, exit_code,
           started_at, completed_at, machine_id, output_digest, output_tail,
           executor_kind, synthetic
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb, 'PASS', 0,
           $16, $17, $18, $19, $20, 'brain_assertion_runner', false
         )
         ON CONFLICT (
           run_id, journey_step_link_id, source_sha, impact_contract_hash
         ) DO NOTHING
         RETURNING *
       )
       SELECT * FROM inserted
       UNION ALL
       SELECT * FROM journey_assertion_receipts
       WHERE run_id = $2 AND journey_step_link_id = $1
         AND source_sha = $7 AND impact_contract_hash = $11
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
        gpContractId,
        gpContractHash,
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
      receipts.push(receiptResult.rows[0]);
    }
  }
  return receipts;
}
import { canonicalAssertionArgv } from '../lib/gp-assertion-command.js';
