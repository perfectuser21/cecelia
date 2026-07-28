/**
 * Pure validator/projector for the Kernel P0/P1 equivalence section embedded in
 * the root regression-contract.yaml.
 *
 * This module never queries or writes PostgreSQL. Its journey output is only a
 * proposed projection into the existing journey_step_links cell vocabulary.
 */

export const GOLDEN_PATH_STEPS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `S${index}`),
);

export const BEHAVIOR_DIMENSIONS = Object.freeze([
  'fr',
  'nfr',
  'invariant',
  'checkpoint',
  'freshness',
  'death_alert',
  'failure_semantics',
  'effect_confirmation',
  'adversarial_surface',
  'ledger_freshness',
  'axis_alignment',
]);

export const PROOF_PROVIDERS = Object.freeze(['claude', 'codex', 'grok']);
export const PROOF_SCENARIOS = Object.freeze(['normal', 'violation', 'recovery']);

const CLAIMED_STATUSES = new Set(['proven', 'gap', 'intentional_replacement']);
const DENIAL_RESULTS = new Set(['blocked', 'denied', 'failed', 'rejected']);
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PSEUDO_PROOF = [
  /(?:^|[;&|]\s*)(?:grep|rg)\b/i,
  /(?:^|[;&|]\s*)test\s+-[ef]\b/i,
  /(?:^|\s)(?:README(?:\.md)?|docs\/)/i,
  /(?:^|[/_-])smoke(?:[/_.-]|$)/i,
];
const EXECUTABLE_TEST = /(?:vitest|(?:^|\s|\/)__tests__\/|(?:^|\s|\/)tests?\/|\.test\.[cm]?[jt]s\b)/i;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validDate(value) {
  if (!nonEmpty(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function addFinding(findings, behaviorId, code, path, message) {
  findings.push({
    severity: 'error',
    behavior_id: behaviorId ?? null,
    code,
    path,
    message,
  });
}

function commandIsPseudoProof(command) {
  return !nonEmpty(command)
    || PSEUDO_PROOF.some((pattern) => pattern.test(command))
    || !EXECUTABLE_TEST.test(command);
}

function validateCatalog(section, findings) {
  const stepIds = asArray(section?.journey?.steps).map((step) => step?.id);
  for (const step of GOLDEN_PATH_STEPS) {
    if (!stepIds.includes(step)) {
      addFinding(findings, null, 'golden_path_step_missing', `journey.steps.${step}`, `${step} is missing`);
    }
  }
  const dimensions = asArray(section?.dimensions);
  for (const dimension of BEHAVIOR_DIMENSIONS) {
    if (!dimensions.includes(dimension)) {
      addFinding(
        findings,
        null,
        'behavior_dimension_missing',
        `dimensions.${dimension}`,
        `${dimension} is missing`,
      );
    }
  }
}

function validateBehaviorAxes(behavior, behaviorFindings, goldenPathIds) {
  const id = behavior.behavior_id;
  if (!nonEmpty(id)) addFinding(behaviorFindings, id, 'behavior_id_missing', 'behavior_id', 'behavior_id is required');
  if (!['P0', 'P1'].includes(behavior.priority)) {
    addFinding(behaviorFindings, id, 'priority_invalid', 'priority', 'priority must be P0 or P1');
  }
  if (!nonEmpty(behavior.owner)) addFinding(behaviorFindings, id, 'owner_missing', 'owner', 'owner is required');
  if (!nonEmpty(behavior.contract_version)) {
    addFinding(behaviorFindings, id, 'contract_version_missing', 'contract_version', 'contract_version is required');
  }
  if (!CLAIMED_STATUSES.has(behavior.status)) {
    addFinding(behaviorFindings, id, 'status_invalid', 'status', 'status is not supported');
  }
  if (!nonEmpty(behavior.legacy_behavior) || asArray(behavior.legacy_evidence).length === 0) {
    addFinding(
      behaviorFindings,
      id,
      'legacy_evidence_missing',
      'legacy_evidence',
      'legacy behavior and evidence are required',
    );
  }
  if (asArray(behavior.unified_constructs).length === 0) {
    addFinding(
      behaviorFindings,
      id,
      'unified_construct_missing',
      'unified_constructs',
      'at least one unified construct is required',
    );
  }
  const steps = asArray(behavior.steps);
  if (steps.length === 0 || steps.some((step) => !GOLDEN_PATH_STEPS.includes(step))) {
    addFinding(behaviorFindings, id, 'behavior_step_invalid', 'steps', 'steps must reference S0-S12');
  }
  const dimensions = asArray(behavior.dimensions);
  if (
    dimensions.length === 0
    || dimensions.some((dimension) => !BEHAVIOR_DIMENSIONS.includes(dimension))
  ) {
    addFinding(
      behaviorFindings,
      id,
      'behavior_dimension_invalid',
      'dimensions',
      'dimensions must reference the canonical eleven dimensions',
    );
  }
  if (!nonEmpty(behavior.assertion_id) || !goldenPathIds.has(behavior.assertion_id)) {
    addFinding(
      behaviorFindings,
      id,
      'assertion_reference_invalid',
      'assertion_id',
      'assertion_id must reference root golden_paths',
    );
  }
  if (!nonEmpty(behavior.failure_semantics)) {
    addFinding(
      behaviorFindings,
      id,
      'failure_semantics_missing',
      'failure_semantics',
      'failure semantics are required',
    );
  }
}

function validateProofIdentity(behavior, behaviorFindings, now) {
  const id = behavior.behavior_id;
  const proofIdentity = asObject(behavior.proof_identity);
  if (!SHA_PATTERN.test(proofIdentity.artifact_sha ?? '')) {
    addFinding(
      behaviorFindings,
      id,
      'artifact_sha_invalid',
      'proof_identity.artifact_sha',
      'exact 40/64 lowercase hex artifact SHA is required',
    );
  }
  if (!nonEmpty(proofIdentity.version)) {
    addFinding(
      behaviorFindings,
      id,
      'proof_version_missing',
      'proof_identity.version',
      'proof version is required',
    );
  }
  if (!nonEmpty(proofIdentity.effect_receipt_id)) {
    addFinding(
      behaviorFindings,
      id,
      'effect_receipt_missing',
      'proof_identity.effect_receipt_id',
      'effect receipt identity is required',
    );
  }

  const freshness = asObject(behavior.freshness);
  const verifiedAt = validDate(freshness.verified_at);
  const expiresAt = validDate(freshness.expires_at);
  if (verifiedAt == null) {
    addFinding(
      behaviorFindings,
      id,
      'verified_at_missing',
      'freshness.verified_at',
      'verified_at is required',
    );
  }
  if (expiresAt == null) {
    addFinding(
      behaviorFindings,
      id,
      'expires_at_missing',
      'freshness.expires_at',
      'expires_at is required',
    );
  }
  if (verifiedAt != null && expiresAt != null && expiresAt <= verifiedAt) {
    addFinding(
      behaviorFindings,
      id,
      'freshness_window_invalid',
      'freshness',
      'expires_at must be later than verified_at',
    );
  }
  if (expiresAt != null && expiresAt <= now) {
    addFinding(
      behaviorFindings,
      id,
      'proof_stale',
      'freshness.expires_at',
      'proof is past its freshness deadline',
    );
  }
}

function validateProofMatrix(behavior, behaviorFindings) {
  const id = behavior.behavior_id;
  const matrix = asObject(behavior.proof_matrix);
  for (const provider of PROOF_PROVIDERS) {
    const providerProof = asObject(matrix[provider]);
    for (const scenario of PROOF_SCENARIOS) {
      const path = `proof_matrix.${provider}.${scenario}`;
      const proof = asObject(providerProof[scenario]);
      if (Object.keys(proof).length === 0) {
        addFinding(
          behaviorFindings,
          id,
          'provider_scenario_missing',
          path,
          `${provider}/${scenario} proof is required`,
        );
        continue;
      }
      if (commandIsPseudoProof(proof.test_command)) {
        addFinding(
          behaviorFindings,
          id,
          'pseudo_proof_command',
          `${path}.test_command`,
          'proof command must execute a behavioral test, not docs/static grep/smoke-only checks',
        );
      }
      if (!nonEmpty(proof.expected_result) || !nonEmpty(proof.observed_result)) {
        addFinding(
          behaviorFindings,
          id,
          'proof_result_missing',
          path,
          'expected and observed results are required',
        );
      }
      if (asArray(proof.evidence_refs).length === 0) {
        addFinding(
          behaviorFindings,
          id,
          'proof_evidence_ref_missing',
          `${path}.evidence_refs`,
          'at least one evidence ref is required',
        );
      }
      if (!nonEmpty(proof.effect_receipt_id)) {
        addFinding(
          behaviorFindings,
          id,
          'proof_effect_receipt_missing',
          `${path}.effect_receipt_id`,
          'provider/scenario effect receipt identity is required',
        );
      }
      if (scenario === 'violation' && !DENIAL_RESULTS.has(proof.observed_result)) {
        addFinding(
          behaviorFindings,
          id,
          'violation_not_proven_to_fire',
          `${path}.observed_result`,
          'violation proof must observe blocked/denied/failed/rejected',
        );
      }
    }
  }
}

function validateGap(behavior, behaviorFindings) {
  const gap = asObject(behavior.gap);
  for (const field of ['reason', 'owner', 'closure_plan']) {
    if (!nonEmpty(gap[field])) {
      addFinding(
        behaviorFindings,
        behavior.behavior_id,
        `gap_${field}_missing`,
        `gap.${field}`,
        `gap ${field} is required`,
      );
    }
  }
}

function validateReplacement(behavior, behaviorFindings) {
  const replacement = asObject(behavior.replacement);
  for (const field of ['legacy_construct', 'unified_construct', 'rationale']) {
    if (!nonEmpty(replacement[field])) {
      addFinding(
        behaviorFindings,
        behavior.behavior_id,
        `replacement_${field === 'rationale' ? 'rationale' : field}_missing`,
        `replacement.${field}`,
        `replacement ${field} is required`,
      );
    }
  }
}

function validateSupersession(behaviors, findings) {
  const ids = new Set(behaviors.map((behavior) => behavior.behavior_id).filter(nonEmpty));
  const next = new Map();
  for (const behavior of behaviors) {
    if (!nonEmpty(behavior.superseded_by)) continue;
    if (!ids.has(behavior.superseded_by)) {
      addFinding(
        findings,
        behavior.behavior_id,
        'supersession_target_missing',
        'superseded_by',
        `supersession target ${behavior.superseded_by} does not exist`,
      );
      continue;
    }
    next.set(behavior.behavior_id, behavior.superseded_by);
  }

  const globallyVisited = new Set();
  for (const start of next.keys()) {
    if (globallyVisited.has(start)) continue;
    const localPath = [];
    const localIndex = new Map();
    let current = start;
    while (next.has(current)) {
      if (localIndex.has(current)) {
        const cycle = localPath.slice(localIndex.get(current)).concat(current);
        addFinding(
          findings,
          current,
          'supersession_cycle',
          'superseded_by',
          `supersession cycle: ${cycle.join(' -> ')}`,
        );
        break;
      }
      if (globallyVisited.has(current)) break;
      localIndex.set(current, localPath.length);
      localPath.push(current);
      current = next.get(current);
    }
    for (const id of localPath) globallyVisited.add(id);
  }
}

export function validateBehaviorEquivalence(contract, { now = Date.now() } = {}) {
  const findings = [];
  const section = contract?.behavior_equivalence;
  if (!section || typeof section !== 'object') {
    addFinding(
      findings,
      null,
      'behavior_equivalence_missing',
      'behavior_equivalence',
      'root regression contract must define behavior_equivalence',
    );
    return {
      valid: false,
      contract_version: null,
      findings,
      behaviors: [],
    };
  }

  validateCatalog(section, findings);
  const goldenPathIds = new Set(asArray(contract.golden_paths).map((item) => item?.id));
  const sourceBehaviors = asArray(section.behaviors);
  const normalizedBehaviors = sourceBehaviors.map((source) => {
    const behavior = structuredClone(source);
    const behaviorFindings = [];
    validateBehaviorAxes(behavior, behaviorFindings, goldenPathIds);

    if (behavior.status === 'gap') {
      validateGap(behavior, behaviorFindings);
    } else {
      validateProofIdentity(behavior, behaviorFindings, now);
      validateProofMatrix(behavior, behaviorFindings);
      if (behavior.status === 'intentional_replacement') {
        validateReplacement(behavior, behaviorFindings);
      }
    }

    findings.push(...behaviorFindings);
    return {
      ...behavior,
      claimed_status: behavior.status ?? null,
      effective_status: behavior.status === 'gap' || behaviorFindings.length > 0
        ? 'gap'
        : behavior.status,
      findings: behaviorFindings,
    };
  });
  validateSupersession(normalizedBehaviors, findings);

  return {
    valid: findings.length === 0,
    schema_version: section.schema_version ?? null,
    contract_version: section.contract_version ?? null,
    journey: section.journey ?? null,
    dimensions: asArray(section.dimensions),
    findings,
    behaviors: normalizedBehaviors,
  };
}

export function projectJourneyCells(validation) {
  return asArray(validation?.behaviors).flatMap((behavior) => {
    const onlyStale = behavior.findings?.length > 0
      && behavior.findings.every((finding) => finding.code === 'proof_stale');
    const cellStatus = ['proven', 'intentional_replacement'].includes(behavior.effective_status)
      ? 'green'
      : onlyStale ? 'pending' : 'red';
    return asArray(behavior.steps).flatMap((step) => (
      asArray(behavior.dimensions).map((dimension) => ({
        journey_key: validation?.journey?.key ?? null,
        behavior_id: behavior.behavior_id ?? null,
        step,
        dimension,
        cell_kind: 'element',
        cell_key: dimension,
        cell_status: cellStatus,
        assertion_ref: behavior.assertion_id ?? null,
        reason: behavior.effective_status === 'gap'
          ? behavior.gap?.reason ?? behavior.findings?.map((finding) => finding.code).join(',')
          : null,
        write_database: false,
      }))
    ));
  });
}

export function buildEvidenceEnvelopes(validation) {
  return asArray(validation?.behaviors).flatMap((behavior) => (
    PROOF_PROVIDERS.flatMap((provider) => (
      PROOF_SCENARIOS.map((scenario) => {
        const proof = behavior.proof_matrix?.[provider]?.[scenario] ?? {};
        return {
          behavior_id: behavior.behavior_id ?? null,
          priority: behavior.priority ?? null,
          contract_version: behavior.contract_version ?? null,
          claimed_status: behavior.claimed_status ?? null,
          effective_status: behavior.effective_status ?? null,
          journey_steps: asArray(behavior.steps),
          dimensions: asArray(behavior.dimensions),
          legacy_behavior: behavior.legacy_behavior ?? null,
          legacy_evidence: asArray(behavior.legacy_evidence),
          kernel_enforcers: asArray(behavior.unified_constructs),
          provider,
          scenario,
          test_command: proof.test_command ?? null,
          expected_result: proof.expected_result ?? null,
          observed_result: proof.observed_result ?? null,
          artifact_sha: behavior.proof_identity?.artifact_sha ?? null,
          artifact_version: behavior.proof_identity?.version ?? null,
          verified_at: behavior.freshness?.verified_at ?? null,
          expires_at: behavior.freshness?.expires_at ?? null,
          effect_receipt_id: proof.effect_receipt_id ?? null,
          evidence_refs: asArray(proof.evidence_refs),
          assertion_id: behavior.assertion_id ?? null,
        };
      })
    ))
  ));
}
