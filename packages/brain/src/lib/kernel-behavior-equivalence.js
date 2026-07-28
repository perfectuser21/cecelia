import {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';
import { compileDrillPlan } from './kernel-equivalence-drills.js';
import {
  createTrustedReceiptResolver,
} from './kernel-equivalence-receipt-resolver.js';

/**
 * Pure validator/projector for the Kernel P0/P1 equivalence section embedded in
 * the root regression-contract.yaml.
 *
 * This module never queries or writes PostgreSQL. Its journey output is only a
 * proposed projection into the existing journey_step_links cell vocabulary.
 */

export {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
};

const CLAIMED_STATUSES = new Set(['proven', 'gap', 'intentional_replacement']);
const DENIAL_RESULTS = new Set(['blocked', 'denied', 'failed', 'rejected']);
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PSEUDO_PROOF = [
  /(?:^|[;&|]\s*)(?:grep|rg)\b/i,
  /(?:^|[;&|]\s*)test\s+-[ef]\b/i,
  /(?:^|\s)(?:README(?:\.md)?|docs\/)/i,
  /(?:^|[/_-])smoke(?:[/_.-]|$)/i,
];
const LIVE_PROOF_CELL = /^[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const LIVE_GRANT_REF =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

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

function classifyProofCommand(command, expectedCellId) {
  if (!nonEmpty(command)) return 'non_live';
  if (PSEUDO_PROOF.some((pattern) => pattern.test(command))) return 'pseudo';
  const tokens = command.trim().split(/\s+/);
  if (
    tokens.length !== 7
    || tokens[0] !== 'node'
    || tokens[1] !== 'scripts/ci/run-kernel-equivalence-drill.mjs'
    || tokens[2] !== '--execute'
    || tokens[3] !== '--cell'
    || !LIVE_PROOF_CELL.test(tokens[4])
    || tokens[4] !== expectedCellId
    || tokens[5] !== '--grant-ref'
    || !LIVE_GRANT_REF.test(tokens[6])
  ) {
    return 'non_live';
  }
  return 'live';
}

function validateCatalog(section, findings) {
  if (!nonEmpty(section?.schema_version)) {
    addFinding(
      findings,
      null,
      'schema_version_missing',
      'behavior_equivalence.schema_version',
      'behavior equivalence schema_version is required',
    );
  }
  if (!nonEmpty(section?.contract_version)) {
    addFinding(
      findings,
      null,
      'equivalence_contract_version_missing',
      'behavior_equivalence.contract_version',
      'behavior equivalence contract_version is required',
    );
  }
  if (!nonEmpty(section?.journey?.key)) {
    addFinding(
      findings,
      null,
      'journey_key_missing',
      'behavior_equivalence.journey.key',
      'journey key is required',
    );
  }
  const requiredBehaviorCount = section?.required_behavior_count;
  const behaviorCount = asArray(section?.behaviors).length;
  if (
    !Number.isInteger(requiredBehaviorCount)
    || requiredBehaviorCount < 1
    || behaviorCount !== requiredBehaviorCount
  ) {
    addFinding(
      findings,
      null,
      'behavior_inventory_count_mismatch',
      'behavior_equivalence.required_behavior_count',
      `expected ${requiredBehaviorCount ?? 'declared count'}, found ${behaviorCount} behaviors`,
    );
  }
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

function validateProofMatrix(
  behavior,
  behaviorFindings,
  receiptResolver,
  verificationMetrics,
) {
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
      const expectedCellId = `${id}::${provider}::${scenario}`;
      const commandClassification = classifyProofCommand(
        proof.test_command,
        expectedCellId,
      );
      if (commandClassification === 'pseudo') {
        addFinding(
          behaviorFindings,
          id,
          'pseudo_proof_command',
          `${path}.test_command`,
          'proof command must execute a behavioral test, not docs/static grep/smoke-only checks',
        );
      } else if (commandClassification !== 'live') {
        addFinding(
          behaviorFindings,
          id,
          'non_live_proof_command',
          `${path}.test_command`,
          'proof command must be the formal single-cell live-effect drill runner',
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
      const receiptReference = proof.receipt_bundle_ref;
      if (
        !nonEmpty(receiptReference)
        || !asArray(proof.evidence_refs).includes(receiptReference)
        || typeof receiptResolver !== 'function'
      ) {
        addFinding(
          behaviorFindings,
          id,
          typeof receiptResolver === 'function'
            ? 'trusted_receipt_bundle_required'
            : 'trusted_receipt_reader_required',
          `${path}.receipt_bundle_ref`,
          'a content-addressed bundle and trusted resolver are required',
        );
        continue;
      }

      const drill = asObject(behavior.drill);
      const expected = {
        cell: {
          cell_id: expectedCellId,
          behavior_id: id,
          provider,
          scenario,
          seam_id: drill.seam_id,
          adapter_id: drill.adapter_id,
          effect_key_id: drill.effect_key_id,
          isolation: structuredClone(asObject(drill.isolation)),
          expected: {
            expected_outcome:
              drill.scenarios?.[scenario]?.expected_outcome,
            effect_code: drill.scenarios?.[scenario]?.effect_code,
            ...(scenario === 'recovery'
              ? {
                predecessor_expected: {
                  expected_outcome:
                    drill.scenarios?.violation?.expected_outcome,
                  effect_code:
                    drill.scenarios?.violation?.effect_code,
                },
              }
              : {}),
          },
        },
        run_id: proof.run_id,
        attempt_id: proof.attempt_id,
        artifact_sha: behavior.proof_identity?.artifact_sha,
        brain_version: behavior.proof_identity?.version,
        engine_version: proof.engine_version,
        grant_id: proof.grant_id,
        nonce: proof.nonce,
        resource_id: proof.resource_id,
        resource_ref: proof.resource_ref,
        resource_prefix: drill.isolation?.resource_prefix
          ?.replaceAll('{run_id}', proof.run_id)
          .replaceAll('{attempt_id}', proof.attempt_id),
      };
      try {
        const verified = receiptResolver(receiptReference, expected);
        const finalReceipt = asArray(verified?.effect_receipts).at(-1);
        const expectedOutcome = drill.scenarios?.[scenario]?.expected_outcome;
        if (
          !asArray(verified?.receipt_ids).includes(proof.effect_receipt_id)
          || finalReceipt?.receipt_id !== proof.effect_receipt_id
          || finalReceipt?.observed_outcome !== expectedOutcome
          || finalReceipt?.effect_code !== drill.scenarios?.[scenario]?.effect_code
        ) {
          throw new Error('trusted receipt outcome mismatch');
        }
        verificationMetrics.verifiedProofCellCount += 1;
      } catch (error) {
        addFinding(
          behaviorFindings,
          id,
          'trusted_receipt_bundle_invalid',
          `${path}.receipt_bundle_ref`,
          `trusted receipt verification failed: ${error?.code ?? 'invalid_bundle'}`,
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
        for (const behaviorId of new Set(cycle.slice(0, -1))) {
          addFinding(
            findings,
            behaviorId,
            'supersession_cycle',
            'superseded_by',
            `supersession cycle: ${cycle.join(' -> ')}`,
          );
        }
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

export function validateBehaviorEquivalence(
  contract,
  {
    now = Date.now(),
    readBundle = null,
  } = {},
) {
  const findings = [];
  const verificationMetrics = {
    verifiedProofCellCount: 0,
  };
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
  let manifestValid = true;
  try {
    compileDrillPlan(contract, { now });
  } catch (error) {
    manifestValid = false;
    addFinding(
      findings,
      null,
      error?.code ?? 'drill_manifest_invalid',
      'behavior_equivalence.behaviors',
      `canonical drill manifest invalid: ${error?.code ?? 'unknown'}`,
    );
  }
  let receiptResolver = null;
  const hasBundleReferences = asArray(section.behaviors).some((behavior) => (
    PROOF_PROVIDERS.some((provider) => (
      PROOF_SCENARIOS.some((scenario) => (
        nonEmpty(behavior?.proof_matrix?.[provider]?.[scenario]?.receipt_bundle_ref)
      ))
    ))
  ));
  if (typeof readBundle === 'function' && hasBundleReferences) {
    try {
      receiptResolver = createTrustedReceiptResolver({
        readBundle,
        trustRegistry: section.drill_trust_registry,
        bundleChain: section.drill_bundle_chain,
        now,
      });
    } catch (error) {
      addFinding(
        findings,
        null,
        error?.code ?? 'trusted_receipt_reader_invalid',
        'behavior_equivalence.drill_trust_registry',
        'trusted receipt reader could not be initialized',
      );
    }
  }
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
      validateProofMatrix(
        behavior,
        behaviorFindings,
        receiptResolver,
        verificationMetrics,
      );
      if (behavior.status === 'intentional_replacement') {
        validateReplacement(behavior, behaviorFindings);
      }
    }

    findings.push(...behaviorFindings);
    return {
      ...behavior,
      claimed_status: behavior.status ?? null,
      effective_status:
        behavior.status === 'gap'
        || behaviorFindings.length > 0
        || !manifestValid
        ? 'gap'
        : behavior.status,
      findings: behaviorFindings,
    };
  });
  const supersessionFindingStart = findings.length;
  validateSupersession(normalizedBehaviors, findings);
  const supersessionFindings = findings.slice(supersessionFindingStart);
  for (const behavior of normalizedBehaviors) {
    const behaviorSupersessionFindings = supersessionFindings.filter(
      (finding) => finding.behavior_id === behavior.behavior_id,
    );
    if (behaviorSupersessionFindings.length > 0) {
      behavior.findings.push(...behaviorSupersessionFindings);
      behavior.effective_status = 'gap';
    }
  }

  return {
    valid: findings.length === 0,
    schema_version: section.schema_version ?? null,
    contract_version: section.contract_version ?? null,
    journey: section.journey ?? null,
    dimensions: asArray(section.dimensions),
    verified_proof_cell_count: verificationMetrics.verifiedProofCellCount,
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

function countBy(items, key, knownValues) {
  const counts = Object.fromEntries(knownValues.map((value) => [value, 0]));
  for (const item of items) {
    const value = item?.[key];
    if (Object.hasOwn(counts, value)) counts[value] += 1;
  }
  return counts;
}

export function buildEquivalenceReport(
  validation,
  { evaluatedAt = null } = {},
) {
  const behaviors = asArray(validation?.behaviors);
  const envelopes = buildEvidenceEnvelopes(validation);
  const projectedCells = projectJourneyCells(validation);
  const requiredCells = behaviors.length * PROOF_PROVIDERS.length * PROOF_SCENARIOS.length;
  const receiptedCells = envelopes.filter((envelope) => nonEmpty(envelope.effect_receipt_id)).length;
  const provenToFireCommands = envelopes
    .filter((envelope) => (
      envelope.effective_status === 'proven'
      && envelope.scenario === 'violation'
      && nonEmpty(envelope.test_command)
      && DENIAL_RESULTS.has(envelope.observed_result)
      && nonEmpty(envelope.effect_receipt_id)
    ))
    .map((envelope) => ({
      behavior_id: envelope.behavior_id,
      provider: envelope.provider,
      scenario: envelope.scenario,
      test_command: envelope.test_command,
      observed_result: envelope.observed_result,
      effect_receipt_id: envelope.effect_receipt_id,
    }))
    .sort((left, right) => (
      `${left.behavior_id}:${left.provider}`.localeCompare(`${right.behavior_id}:${right.provider}`)
    ));

  return {
    report_version: '1.0.0',
    contract_version: validation?.contract_version ?? null,
    evaluated_at: evaluatedAt,
    valid: validation?.valid === true,
    summary: {
      total: behaviors.length,
      by_priority: countBy(behaviors, 'priority', ['P0', 'P1']),
      by_effective_status: countBy(
        behaviors,
        'effective_status',
        ['proven', 'gap', 'intentional_replacement'],
      ),
      findings: asArray(validation?.findings).length,
    },
    axes: {
      steps: [...GOLDEN_PATH_STEPS],
      dimensions: [...BEHAVIOR_DIMENSIONS],
      providers: [...PROOF_PROVIDERS],
      scenarios: [...PROOF_SCENARIOS],
      possible_cells: GOLDEN_PATH_STEPS.length * BEHAVIOR_DIMENSIONS.length,
      grid: GOLDEN_PATH_STEPS.map((step) => ({
        step,
        cells: Object.fromEntries(BEHAVIOR_DIMENSIONS.map((dimension) => {
          const statuses = projectedCells
            .filter((cell) => cell.step === step && cell.dimension === dimension)
            .map((cell) => cell.cell_status);
          const status = statuses.includes('red')
            ? 'red'
            : statuses.includes('pending')
              ? 'pending'
              : statuses.includes('green')
                ? 'green'
                : 'unaccounted';
          return [dimension, status];
        })),
      })),
    },
    provider_matrix: {
      required_cells: requiredCells,
      receipted_cells: receiptedCells,
      missing_cells: requiredCells - receiptedCells,
      cells: PROOF_PROVIDERS.flatMap((provider) => (
        PROOF_SCENARIOS.map((scenario) => {
          const matching = envelopes.filter((envelope) => (
            envelope.provider === provider && envelope.scenario === scenario
          ));
          const receipted = matching.filter((envelope) => nonEmpty(envelope.effect_receipt_id)).length;
          return {
            provider,
            scenario,
            required: behaviors.length,
            receipted,
            missing: behaviors.length - receipted,
          };
        })
      )),
    },
    proven_to_fire_commands: provenToFireCommands,
    gaps: behaviors
      .filter((behavior) => behavior.effective_status === 'gap')
      .map((behavior) => ({
        behavior_id: behavior.behavior_id ?? null,
        priority: behavior.priority ?? null,
        claimed_status: behavior.claimed_status ?? null,
        reason: behavior.gap?.reason
          ?? asArray(behavior.findings).map((finding) => finding.message).join('; ')
          ?? null,
        owner: behavior.gap?.owner ?? behavior.owner ?? null,
        closure_plan: behavior.gap?.closure_plan ?? null,
        finding_codes: asArray(behavior.findings).map((finding) => finding.code),
      }))
      .sort((left, right) => `${left.behavior_id}`.localeCompare(`${right.behavior_id}`)),
    behaviors: behaviors
      .map((behavior) => ({
        behavior_id: behavior.behavior_id ?? null,
        priority: behavior.priority ?? null,
        claimed_status: behavior.claimed_status ?? null,
        effective_status: behavior.effective_status ?? null,
        steps: asArray(behavior.steps),
        dimensions: asArray(behavior.dimensions),
        verified_at: behavior.freshness?.verified_at ?? null,
        expires_at: behavior.freshness?.expires_at ?? null,
        assertion_id: behavior.assertion_id ?? null,
        legacy_behavior: behavior.legacy_behavior ?? null,
        legacy_evidence: asArray(behavior.legacy_evidence),
        unified_constructs: asArray(behavior.unified_constructs),
        failure_semantics: behavior.failure_semantics ?? null,
        partial_behavioral_evidence: asArray(behavior.partial_behavioral_evidence),
      }))
      .sort((left, right) => `${left.behavior_id}`.localeCompare(`${right.behavior_id}`)),
  };
}

function markdownCell(value) {
  if (value == null || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function formatEquivalenceMarkdown(report) {
  const summary = asObject(report?.summary);
  const matrix = asObject(report?.provider_matrix);
  const axes = asObject(report?.axes);
  const behaviors = asArray(report?.behaviors);
  const gaps = asArray(report?.gaps);
  const fireCommands = asArray(report?.proven_to_fire_commands);
  const providerCells = asArray(matrix.cells);
  const grid = asArray(axes.grid);
  const gridSymbol = {
    green: 'G',
    pending: 'P',
    red: 'R',
    unaccounted: '—',
  };
  const lines = [
    '# Kernel P0/P1 行为等价报告',
    '',
    `- 合同版本：\`${markdownCell(report?.contract_version)}\``,
    `- 评估时间：\`${markdownCell(report?.evaluated_at)}\``,
    `- 合同行为数：${summary.total ?? 0}（P0 ${summary.by_priority?.P0 ?? 0} / P1 ${summary.by_priority?.P1 ?? 0}）`,
    `- 有效状态：proven ${summary.by_effective_status?.proven ?? 0} / gap ${summary.by_effective_status?.gap ?? 0} / intentional_replacement ${summary.by_effective_status?.intentional_replacement ?? 0}`,
    `- Provider 场景证据：${matrix.receipted_cells ?? 0}/${matrix.required_cells ?? 0}，缺 ${matrix.missing_cells ?? 0}`,
    `- 轴：${asArray(axes.steps).length} 个步骤（S0–S12）× 11 项行为维度 = ${axes.possible_cells ?? 0} 个可能单元`,
    '',
    '> 缺口不是证明。只有绑定 exact SHA/version、未过期 freshness、effect receipt，且 Claude/Codex/Grok × normal/violation/recovery 全覆盖，才是 proven。',
    '',
    '## 行为清单',
    '',
    '| Behavior | Priority | Claimed | Effective | Steps | Dimensions |',
    '|---|---:|---|---|---|---|',
    ...behaviors.map((behavior) => (
      `| ${markdownCell(behavior.behavior_id)} | ${markdownCell(behavior.priority)} | ${markdownCell(behavior.claimed_status)} | ${markdownCell(behavior.effective_status)} | ${markdownCell(behavior.steps.join(', '))} | ${markdownCell(behavior.dimensions.join(', '))} |`
    )),
    '',
    '## S0–S12 × 11 要素投影',
    '',
    'R = 有真实缺口；P = 证据过期；G = 完整证明；— = 尚未映射。',
    '',
    `| Step | ${asArray(axes.dimensions).join(' | ')} |`,
    `|---|${asArray(axes.dimensions).map(() => '---').join('|')}|`,
    ...grid.map((row) => (
      `| ${markdownCell(row.step)} | ${asArray(axes.dimensions).map((dimension) => gridSymbol[row.cells?.[dimension]] ?? '—').join(' | ')} |`
    )),
    '',
    '## Provider × 场景证据矩阵',
    '',
    '| Provider | Scenario | Receipted | Required | Missing |',
    '|---|---|---:|---:|---:|',
    ...providerCells.map((cell) => (
      `| ${markdownCell(cell.provider)} | ${markdownCell(cell.scenario)} | ${cell.receipted} | ${cell.required} | ${cell.missing} |`
    )),
    '',
    '## Legacy → Kernel unified construct 对照',
    '',
  ];

  for (const behavior of behaviors) {
    lines.push(
      `### ${markdownCell(behavior.behavior_id)}`,
      '',
      `- 旧行为：${markdownCell(behavior.legacy_behavior)}`,
      `- 旧证据：${behavior.legacy_evidence.length > 0 ? behavior.legacy_evidence.map((item) => `\`${markdownCell(item)}\``).join(', ') : '—'}`,
      `- Unified constructs：${behavior.unified_constructs.length > 0 ? behavior.unified_constructs.map(markdownCell).join('; ') : '—'}`,
      `- 失败语义：${markdownCell(behavior.failure_semantics)}`,
      `- Freshness：verified ${markdownCell(behavior.verified_at)} / expires ${markdownCell(behavior.expires_at)}`,
      `- 部分行为证据（不等于 proven）：${behavior.partial_behavioral_evidence.length > 0 ? behavior.partial_behavioral_evidence.map((item) => `\`${markdownCell(item)}\``).join(', ') : '—'}`,
      '',
    );
  }

  lines.push(
    '## Proven-to-fire 命令',
    '',
  );

  if (fireCommands.length === 0) {
    lines.push('没有命令达到完整 proven-to-fire 证据门槛。');
  } else {
    for (const proof of fireCommands) {
      lines.push(
        `- ${markdownCell(proof.behavior_id)} / ${markdownCell(proof.provider)}: \`${markdownCell(proof.test_command)}\` → ${markdownCell(proof.observed_result)}（${markdownCell(proof.effect_receipt_id)}）`,
      );
    }
  }

  lines.push('', '## 真实缺口', '');
  if (gaps.length === 0) {
    lines.push('无。');
  } else {
    for (const gap of gaps) {
      lines.push(
        `### ${markdownCell(gap.behavior_id)}（${markdownCell(gap.priority)}）`,
        '',
        `- 原因：${markdownCell(gap.reason)}`,
        `- Owner：${markdownCell(gap.owner)}`,
        `- 收口计划：${markdownCell(gap.closure_plan)}`,
        '',
      );
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
