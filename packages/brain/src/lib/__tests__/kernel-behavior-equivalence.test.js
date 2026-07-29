import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_DIMENSIONS,
  GOLDEN_PATH_STEPS,
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
  buildEquivalenceReport,
  buildEvidenceEnvelopes,
  deriveFamilyEffectiveStatus,
  formatEquivalenceMarkdown,
  projectJourneyCells,
  validateBehaviorEquivalence,
} from '../kernel-behavior-equivalence.js';
import { createTrustedReceiptResolver } from '../kernel-equivalence-receipt-resolver.js';
import { sha256Canonical } from '../kernel-equivalence-receipts.js';
import {
  FIXTURE_NOW,
  FIXTURE_SHA,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureGrant,
  fixtureReceipt,
  signFixture,
} from './kernel-equivalence-test-fixtures.js';

const NOW = FIXTURE_NOW;
const SHA = FIXTURE_SHA;

function rootContract() {
  return load(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
}

function completeProof(provider, scenario) {
  return {
    test_command: `npx vitest run packages/brain/src/orchestrator/__tests__/merge-authority.test.js -t '${provider} ${scenario}'`,
    expected_result: scenario === 'violation' ? 'blocked' : 'pass',
    observed_result: scenario === 'violation' ? 'blocked' : 'pass',
    evidence_refs: [`test:merge-authority:${provider}:${scenario}`],
    effect_receipt_id: `receipt:test:${provider}:${scenario}:${SHA}`,
  };
}

function completeMatrix() {
  return Object.fromEntries(PROOF_PROVIDERS.map((provider) => [
    provider,
    Object.fromEntries(PROOF_SCENARIOS.map((scenario) => [
      scenario,
      completeProof(provider, scenario),
    ])),
  ]));
}

function steps() {
  return GOLDEN_PATH_STEPS.map((id) => ({ id, name: `Step ${id}` }));
}

function provenBehavior(overrides = {}) {
  return {
    behavior_id: 'KERNEL-P0-MERGE-AUTHORITY',
    priority: 'P0',
    owner: 'kernel.merge_authority',
    contract_version: '1.0.0',
    status: 'proven',
    legacy_behavior: 'Claude controller only merged after all gates.',
    legacy_evidence: ['git:legacy/harness-controller/SKILL.md@2.10.0'],
    unified_constructs: ['kernel.merge_authority', 'kernel.merge_effect_receipt'],
    steps: ['S9'],
    dimensions: [...BEHAVIOR_DIMENSIONS],
    assertion_id: 'KERNEL-MERGE-AUTHORITY-01',
    failure_semantics: 'Missing or stale evidence denies merge.',
    freshness: {
      verified_at: '2026-07-28T08:00:00.000Z',
      expires_at: '2026-08-04T08:00:00.000Z',
    },
    proof_identity: {
      artifact_sha: SHA,
      version: '1.268.7',
      effect_receipt_id: `receipt:test:merge-authority:${SHA}`,
    },
    drill: {
      seam_id: 'kernel.merge.effect_executor',
      seam_ref: 'packages/brain/src/orchestrator/merge-effect-executor.js',
      adapter_id: 'kernel.drill.ci_merge_authority.v1',
      effect_signer_status: 'available',
      effect_key_purpose: 'effect_receipt',
      effect_key_id: 'effect-2026-07',
      blocked_by: null,
      isolation: {
        environment: 'isolated',
        resource_type: 'ephemeral_branch',
        resource_prefix: 'refs/heads/equivalence-drill/{run_id}/{attempt_id}/',
      },
      scenarios: {
        normal: {
          expected_outcome: 'confirmed',
          effect_code: 'exact_sha_merge_confirmed',
        },
        violation: {
          expected_outcome: 'denied',
          effect_code: 'stale_sha_merge_denied',
        },
        recovery: {
          expected_outcome: 'recovered',
          effect_code: 'renewed_authority_merge_confirmed',
          predecessor_scenario: 'violation',
        },
      },
    },
    proof_matrix: completeMatrix(),
    ...overrides,
  };
}

function contract(behaviors = [provenBehavior()]) {
  const root = load(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
  const normalized = behaviors.map((behavior) => {
    const value = structuredClone(behavior);
    if (value.status === 'gap') {
      value.drill.effect_signer_status = 'missing';
      value.drill.effect_key_id = null;
      value.drill.blocked_by = 'seam_receipt_signer_missing';
    }
    return value;
  });
  const usedIds = new Set(normalized.map((behavior) => behavior.behavior_id));
  const fillers = root.behavior_equivalence.behaviors
    .filter((behavior) => !usedIds.has(behavior.behavior_id))
    .slice(0, 11 - normalized.length);
  const customGoldenPaths = normalized
    .map((behavior) => behavior.assertion_id)
    .filter((id) => !root.golden_paths.some((path) => path.id === id))
    .map((id) => ({ id }));
  const value = {
    golden_paths: [...root.golden_paths, ...customGoldenPaths],
    behavior_equivalence: {
      ...root.behavior_equivalence,
      schema_version: '1.0.0',
      contract_version: '2026-07-28.1',
      required_behavior_count: 11,
      journey: {
        key: 'kernel-harness-delivery',
        steps: steps(),
      },
      dimensions: [...BEHAVIOR_DIMENSIONS],
      behaviors: [...normalized, ...fillers],
    },
  };
  for (const field of [
    'required_atomic_invariant_count',
    'proof_required_atomic_invariant_count',
    'required_probe_definition_count',
    'proof_required_probe_definition_count',
    'required_provider_probe_assertion_count',
    'required_retired_absence_probe_count',
  ]) {
    delete value.behavior_equivalence[field];
  }
  value.behavior_equivalence.behaviors =
    value.behavior_equivalence.behaviors.map((behavior) => {
      const legacy = { ...behavior };
      delete legacy.atomic_invariant_count;
      delete legacy.probe_definition_count;
      delete legacy.atomic_invariants;
      return legacy;
    });
  return value;
}

function trustedContract(
  extraBehaviors = [],
  behaviorOverrides = {},
  receiptOverrides = {},
) {
  const behavior = provenBehavior(behaviorOverrides);
  const keys = createTrustFixture(behavior.drill.seam_id);
  behavior.drill.effect_key_id = keys.effect.record.key_id;
  const bundles = new Map();
  const matrix = {};
  let genesisHash = null;
  let previousBundleHash = null;

  for (const provider of PROOF_PROVIDERS) {
    matrix[provider] = {};
    let violationReceipt = null;
    let violationGrant = null;
    for (const scenario of PROOF_SCENARIOS) {
      const target = fixtureCell({
        behaviorId: behavior.behavior_id,
        provider,
        scenario,
        seamId: behavior.drill.seam_id,
        adapterId: behavior.drill.adapter_id,
      });
      const executionGrant = fixtureGrant(keys, target);
      const receipt = fixtureReceipt(
        keys,
        executionGrant,
        target,
        scenario === 'recovery' ? violationReceipt : null,
        receiptOverrides[scenario] ?? {},
      );
      if (scenario === 'violation') {
        violationReceipt = receipt;
        violationGrant = executionGrant;
      }
      const receipts = scenario === 'recovery'
        ? [violationReceipt, receipt]
        : [receipt];
      const executionGrants = scenario === 'recovery'
        ? [violationGrant, executionGrant]
        : [executionGrant];
      const bundle = fixtureBundle(
        keys,
        target,
        executionGrant,
        receipts,
        executionGrants,
        previousBundleHash,
      );
      const bundleHash = sha256Canonical(bundle);
      genesisHash ??= bundleHash;
      previousBundleHash = bundleHash;
      const bundleReference = `receipt-bundle:${bundleHash}`;
      bundles.set(bundleHash, bundle);
      matrix[provider][scenario] = {
        test_command: `node scripts/ci/run-kernel-equivalence-drill.mjs --execute --cell ${target.cell_id} --grant-ref kernel-equivalence-grant:${executionGrant.grant_id}`,
        expected_result: scenario === 'violation' ? 'denied' : 'pass',
        observed_result: scenario === 'violation' ? 'denied' : 'pass',
        evidence_refs: [bundleReference],
        effect_receipt_id: receipt.receipt_id,
        receipt_bundle_ref: bundleReference,
        run_id: executionGrant.run_id,
        attempt_id: executionGrant.attempt_id,
        grant_id: executionGrant.grant_id,
        nonce: executionGrant.nonce,
        resource_id: executionGrant.resource_id,
        resource_ref: executionGrant.resource_ref,
        engine_version: '1.42.0',
      };
    }
  }

  behavior.proof_matrix = matrix;
  for (const scenario of PROOF_SCENARIOS) {
    const observedOutcome = receiptOverrides[scenario]?.observed_outcome;
    const effectCode = receiptOverrides[scenario]?.effect_code;
    if (observedOutcome != null) {
      behavior.drill.scenarios[scenario].expected_outcome = observedOutcome;
    }
    if (effectCode != null) {
      behavior.drill.scenarios[scenario].effect_code = effectCode;
    }
  }
  behavior.proof_identity.effect_receipt_id = 'signed-3x3-bundle-set';
  const value = contract([behavior, ...extraBehaviors]);
  value.behavior_equivalence.drill_trust_registry = keys.registry;
  value.behavior_equivalence.drill_bundle_chain = {
    schema_version: 'kernel-equivalence-bundle-chain/v1',
    genesis_hash: genesisHash,
    head_hash: previousBundleHash,
  };
  const receiptResolver = createTrustedReceiptResolver({
    readBundle: (hash) => bundles.get(hash),
    trustRegistry: keys.registry,
    bundleChain: value.behavior_equivalence.drill_bundle_chain,
    now: NOW,
  });
  return {
    contract: value,
    receiptResolver,
    readBundle: (hash) => bundles.get(hash),
    behavior,
  };
}

function trustedAtomicContract() {
  const value = rootContract();
  const bundles = new Map();
  const registryKeys = [];
  let registry = null;
  let genesisHash = null;
  let previousBundleHash = null;

  value.behavior_equivalence.behaviors.forEach((behavior, familyIndex) => {
    const keys = createTrustFixture(behavior.drill.seam_id);
    keys.authority.record.key_id = `authority-2026-07-${familyIndex}`;
    keys.effect.record.key_id = `effect-2026-07-${familyIndex}`;
    keys.collector.record.key_id = `collector-2026-07-${familyIndex}`;
    registry ??= { ...keys.registry, keys: registryKeys };
    registryKeys.push(
      keys.authority.record,
      keys.effect.record,
      keys.collector.record,
    );

    behavior.status = 'proven';
    behavior.proof_identity = {
      artifact_sha: SHA,
      version: '1.268.7',
      effect_receipt_id: `signed-family-bundle-set-${familyIndex}`,
    };
    behavior.freshness = {
      verified_at: '2026-07-28T08:00:00.000Z',
      expires_at: '2026-08-04T08:00:00.000Z',
    };
    behavior.drill.effect_signer_status = 'available';
    behavior.drill.effect_key_id = keys.effect.record.key_id;
    behavior.drill.blocked_by = null;
    const matrix = {};

    for (const provider of PROOF_PROVIDERS) {
      matrix[provider] = {};
      let violationReceipt = null;
      let violationGrant = null;
      for (const scenario of PROOF_SCENARIOS) {
        const scenarioContract = behavior.drill.scenarios[scenario];
        const violationContract = behavior.drill.scenarios.violation;
        const target = fixtureCell({
          behaviorId: behavior.behavior_id,
          provider,
          scenario,
          seamId: behavior.drill.seam_id,
          adapterId: behavior.drill.adapter_id,
        });
        target.effect_key_id = keys.effect.record.key_id;
        target.isolation = structuredClone(behavior.drill.isolation);
        target.expected = {
          expected_outcome: scenarioContract.expected_outcome,
          effect_code: scenarioContract.effect_code,
          ...(scenario === 'recovery'
            ? {
              predecessor_expected: {
                expected_outcome: violationContract.expected_outcome,
                effect_code: violationContract.effect_code,
              },
            }
            : {}),
        };
        const fixtureExecutionGrant = fixtureGrant(keys, target);
        const resourcePrefix = behavior.drill.isolation.resource_prefix
          .replaceAll('{run_id}', fixtureExecutionGrant.run_id)
          .replaceAll('{attempt_id}', fixtureExecutionGrant.attempt_id);
        const executionGrant = signFixture({
          ...fixtureExecutionGrant,
          resource_prefix: resourcePrefix,
          resource_ref: `${resourcePrefix}case`,
        }, keys.authority.privateKey);
        const receipt = fixtureReceipt(
          keys,
          executionGrant,
          target,
          scenario === 'recovery' ? violationReceipt : null,
          {
            observed_outcome: scenarioContract.expected_outcome,
            effect_code: scenarioContract.effect_code,
          },
        );
        if (scenario === 'violation') {
          violationReceipt = receipt;
          violationGrant = executionGrant;
        }
        const receipts = scenario === 'recovery'
          ? [violationReceipt, receipt]
          : [receipt];
        const executionGrants = scenario === 'recovery'
          ? [violationGrant, executionGrant]
          : [executionGrant];
        const bundle = fixtureBundle(
          keys,
          target,
          executionGrant,
          receipts,
          executionGrants,
          previousBundleHash,
        );
        const bundleHash = sha256Canonical(bundle);
        genesisHash ??= bundleHash;
        previousBundleHash = bundleHash;
        bundles.set(bundleHash, bundle);
        const bundleReference = `receipt-bundle:${bundleHash}`;
        matrix[provider][scenario] = {
          test_command: `node scripts/ci/run-kernel-equivalence-drill.mjs --execute --cell ${target.cell_id} --grant-ref kernel-equivalence-grant:${executionGrant.grant_id}`,
          expected_result: scenario === 'violation' ? 'denied' : 'pass',
          observed_result: scenario === 'violation' ? 'denied' : 'pass',
          evidence_refs: [bundleReference],
          effect_receipt_id: receipt.receipt_id,
          receipt_bundle_ref: bundleReference,
          run_id: executionGrant.run_id,
          attempt_id: executionGrant.attempt_id,
          grant_id: executionGrant.grant_id,
          nonce: executionGrant.nonce,
          resource_id: executionGrant.resource_id,
          resource_ref: executionGrant.resource_ref,
          engine_version: '1.42.0',
        };
      }
    }
    behavior.proof_matrix = matrix;
  });

  value.behavior_equivalence.drill_trust_registry = registry;
  value.behavior_equivalence.drill_bundle_chain = {
    schema_version: 'kernel-equivalence-bundle-chain/v1',
    genesis_hash: genesisHash,
    head_hash: previousBundleHash,
  };
  return {
    contract: value,
    readBundle: (hash) => bundles.get(hash),
  };
}

describe('canonical behavior equivalence axes', () => {
  it('locks S0-S12, eleven dimensions, and the provider/scenario matrix', () => {
    expect(GOLDEN_PATH_STEPS).toEqual(
      Array.from({ length: 13 }, (_, index) => `S${index}`),
    );
    expect(BEHAVIOR_DIMENSIONS).toHaveLength(11);
    expect(PROOF_PROVIDERS).toEqual(['claude', 'codex', 'grok']);
    expect(PROOF_SCENARIOS).toEqual(['normal', 'violation', 'recovery']);
  });
});

describe('validateBehaviorEquivalence', () => {
  it('returns stable aliases and counters when behavior_equivalence is missing', () => {
    expect(validateBehaviorEquivalence({}, { now: NOW })).toMatchObject({
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
      verified_proof_cell_count: 0,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      behaviors: [],
    });
  });

  it('keeps schema validity orthogonal to proof completeness for the honest v1.1 gap inventory', () => {
    const result = validateBehaviorEquivalence(rootContract(), { now: NOW });

    expect(result).toMatchObject({
      valid: true,
      schema_valid: true,
      proof_complete: false,
      atomic_cutover_ready: false,
      legacy_verified_family_receipt_count: 0,
      atomic_proven_family_cell_count: 0,
      atomic_metrics: {
        behavior_count: 11,
        atomic_invariant_count: 43,
        proof_required_atomic_invariant_count: 42,
      },
    });
    expect(result.findings).toEqual([]);
    expect(result.behaviors.every(
      (behavior) => behavior.effective_status === 'gap',
    )).toBe(true);
  });

  it('keeps 99 verified legacy family receipts out of atomic proof aggregation', {
    timeout: 15_000,
  }, () => {
    const startedAt = performance.now();
    const trusted = trustedAtomicContract();
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });
    const cells = projectJourneyCells(result);

    expect(result.findings).toEqual([]);
    expect(result).toMatchObject({
      valid: true,
      schema_valid: true,
      verified_proof_cell_count: 99,
      legacy_verified_family_receipt_count: 99,
      atomic_proven_family_cell_count: 0,
      proof_complete: false,
      atomic_cutover_ready: false,
    });
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.cell_status !== 'green')).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(15_000);
  });

  it('makes invalid schema or unverified atomic receipt material invalidate the alias', () => {
    const invalidSchema = rootContract();
    invalidSchema.behavior_equivalence.required_atomic_invariant_count = 42;

    expect(validateBehaviorEquivalence(invalidSchema, { now: NOW })).toMatchObject({
      valid: false,
      schema_valid: false,
      proof_complete: false,
    });

    const unverifiedClaim = rootContract();
    unverifiedClaim.behavior_equivalence.behaviors[0]
      .atomic_invariants[0].proof_status = 'proven';
    const result = validateBehaviorEquivalence(unverifiedClaim, { now: NOW });

    expect(result).toMatchObject({
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_proven_family_cell_count: 0,
    });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'atomic_receipt_v2_verifier_unavailable' }),
    ]));
    expect(result.behaviors[0].effective_status).toBe('gap');
  });

  it('preserves legacy and atomic findings without either result overwriting the other', () => {
    const input = rootContract();
    input.behavior_equivalence.behaviors[0].owner = '';
    input.behavior_equivalence.behaviors[0]
      .atomic_invariants[0].proof_status = 'proven';

    const result = validateBehaviorEquivalence(input, { now: NOW });
    const codes = result.findings.map((finding) => finding.code);

    expect(codes).toContain('owner_missing');
    expect(codes).toContain('atomic_receipt_v2_verifier_unavailable');
    expect(codes.indexOf('owner_missing')).toBeLessThan(
      codes.indexOf('atomic_receipt_v2_verifier_unavailable'),
    );
  });

  it('returns a bounded invalid result instead of throwing on hostile atomic input', () => {
    const hostile = rootContract();
    hostile.behavior_equivalence.behaviors[0].atomic_invariants[0] = new Proxy(
      hostile.behavior_equivalence.behaviors[0].atomic_invariants[0],
      {
        ownKeys() {
          throw new Error('hostile atom');
        },
      },
    );

    expect(() => validateBehaviorEquivalence(hostile, { now: NOW }))
      .not.toThrow();
    expect(validateBehaviorEquivalence(hostile, { now: NOW })).toMatchObject({
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
    });
  });

  it('stops before legacy traversal when the atomic input budget is exceeded', () => {
    const input = rootContract();
    const families = Array(13).fill(input.behavior_equivalence.behaviors[0]);
    let outOfBudgetReads = 0;
    families[12] = {};
    Object.defineProperty(families[12], 'status', {
      enumerable: true,
      get() {
        outOfBudgetReads += 1;
        throw new Error('out-of-budget family must not be inspected');
      },
    });
    input.behavior_equivalence.behaviors = families;

    const result = validateBehaviorEquivalence(input, { now: NOW });

    expect(outOfBudgetReads).toBe(0);
    expect(result).toMatchObject({
      valid: false,
      schema_valid: false,
      proof_complete: false,
      atomic_cutover_ready: false,
    });
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'atomic_contract_input_budget_exceeded',
    }));
  });

  it('does not trust a caller-supplied resolver as a proof authority', () => {
    const trusted = trustedContract();
    const fabricatedResolver = (_reference, expected) => {
      const proof = trusted.behavior.proof_matrix
        [expected.cell.provider][expected.cell.scenario];
      return {
        receipt_ids: [proof.effect_receipt_id],
        effect_receipts: [{
          receipt_id: proof.effect_receipt_id,
          observed_outcome:
            trusted.behavior.drill.scenarios[expected.cell.scenario].expected_outcome,
          effect_code:
            trusted.behavior.drill.scenarios[expected.cell.scenario].effect_code,
        }],
      };
    };

    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      receiptResolver: fabricatedResolver,
    });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'trusted_receipt_reader_required' }),
    ]));
  });

  it('verifies raw bundles internally against the root trust registry', () => {
    const trusted = trustedContract();

    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });

    expect(result.valid).toBe(true);
    expect(result.behaviors[0].effective_status).toBe('proven');
    expect(result.verified_proof_cell_count).toBe(9);
    expect(result.legacy_verified_family_receipt_count).toBe(9);
    expect(result.atomic_proven_family_cell_count).toBe(0);
    expect(result.proof_complete).toBe(false);
  });

  it('reports zero verified proof cells when configured refs are outside a bad chain', () => {
    const trusted = trustedContract();
    trusted.contract.behavior_equivalence.drill_bundle_chain.head_hash =
      'f'.repeat(64);

    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });

    expect(result.valid).toBe(false);
    expect(result.verified_proof_cell_count).toBe(0);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'trusted_receipt_bundle_invalid' }),
    ]));
  });

  it('requires the canonical exact eleven unique behavior manifest', () => {
    const trusted = trustedContract();
    const truncated = structuredClone(trusted.contract);
    truncated.behavior_equivalence.behaviors =
      truncated.behavior_equivalence.behaviors.slice(0, 1);
    truncated.behavior_equivalence.required_behavior_count = 1;
    const short = validateBehaviorEquivalence(truncated, {
      now: NOW,
      readBundle: trusted.readBundle,
    });
    expect(short.valid).toBe(false);
    expect(short.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'drill_behavior_count_invalid' }),
    ]));
    expect(short.behaviors[0].effective_status).toBe('gap');
    expect(projectJourneyCells(short).every(
      (cell) => cell.cell_status !== 'green',
    )).toBe(true);

    const duplicate = load(readFileSync(
      new URL('../../../../../regression-contract.yaml', import.meta.url),
      'utf8',
    ));
    duplicate.behavior_equivalence.behaviors[1].behavior_id =
      duplicate.behavior_equivalence.behaviors[0].behavior_id;
    const repeated = validateBehaviorEquivalence(duplicate, { now: NOW });
    expect(repeated.valid).toBe(false);
    expect(repeated.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'drill_behavior_id_duplicate' }),
    ]));
  });

  it('never treats non-empty receipt strings or unit-test commands as live proof', () => {
    const result = validateBehaviorEquivalence(contract(), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'trusted_receipt_reader_required' }),
      expect.objectContaining({ code: 'non_live_proof_command' }),
    ]));
  });

  it('rejects a silently truncated behavior inventory', () => {
    const truncated = contract();
    truncated.behavior_equivalence.required_behavior_count = 2;

    const result = validateBehaviorEquivalence(truncated, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'behavior_inventory_count_mismatch',
    }));
  });

  it('accepts only a complete, fresh 3x3 proven contract', () => {
    const trusted = trustedContract();
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });

    expect(result.valid).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.behaviors[0]).toMatchObject({
      claimed_status: 'proven',
      effective_status: 'proven',
    });
  });

  it('uses each drill descriptor exact violation outcome instead of hard-coding denied', () => {
    const trusted = trustedContract([], {}, {
      violation: {
        observed_outcome: 'blocked',
        effect_code: 'stale_sha_merge_blocked',
      },
    });
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });

    expect(result.valid).toBe(true);
  });

  it.each([
    ['provider scenario', (behavior) => { delete behavior.proof_matrix.grok.recovery; }],
    ['artifact SHA', (behavior) => { delete behavior.proof_identity.artifact_sha; }],
    ['version', (behavior) => { delete behavior.proof_identity.version; }],
    ['effect receipt', (behavior) => { delete behavior.proof_identity.effect_receipt_id; }],
    ['verified_at', (behavior) => { delete behavior.freshness.verified_at; }],
    ['expires_at', (behavior) => { delete behavior.freshness.expires_at; }],
  ])('auto-demotes false proven to gap when %s is missing', (_label, mutate) => {
    const behavior = provenBehavior();
    mutate(behavior);

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.behaviors[0].claimed_status).toBe('proven');
    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings.some((finding) => finding.behavior_id === behavior.behavior_id)).toBe(true);
  });

  it.each([
    'grep -q merge packages/brain/src/orchestrator/merge-authority.js',
    'rg "merge authorization" README.md',
    'test -f packages/brain/src/orchestrator/merge-authority.js',
    'bash packages/brain/scripts/smoke/kernel-merge-authority-smoke.sh',
  ])('rejects documentation/static/smoke-only pseudo-proof: %s', (testCommand) => {
    const behavior = provenBehavior();
    behavior.proof_matrix.claude.violation.test_command = testCommand;

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'pseudo_proof_command',
      path: 'proof_matrix.claude.violation.test_command',
    }));
  });

  it('requires violation proof to observe a real denial', () => {
    const behavior = provenBehavior();
    behavior.proof_matrix.codex.violation.observed_result = 'pass';

    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'violation_not_proven_to_fire',
    }));
  });

  it('keeps an explicitly documented gap without manufacturing validation errors', () => {
    const gap = provenBehavior({
      status: 'gap',
      gap: {
        reason: 'No real Grok recovery receipt exists.',
        owner: 'kernel.fleet',
        closure_plan: 'Run the production Grok recovery canary and append its receipt.',
      },
      proof_matrix: {},
      proof_identity: {},
    });

    const result = validateBehaviorEquivalence(contract([gap]), { now: NOW });

    expect(result.valid).toBe(true);
    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.behaviors[0].gap.reason).toContain('Grok');
  });

  it('auto-demotes expired proof and never projects it green', () => {
    const trusted = trustedContract([], {
      freshness: {
        verified_at: '2026-07-01T00:00:00.000Z',
        expires_at: '2026-07-20T00:00:00.000Z',
      },
    });
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });
    const cells = projectJourneyCells(result);

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({ code: 'proof_stale' }));
    expect(cells.every((cell) => cell.cell_status !== 'green')).toBe(true);
    expect(cells.filter((cell) => (
      cell.behavior_id === trusted.behavior.behavior_id
    )).every((cell) => cell.cell_status === 'pending')).toBe(true);
  });

  it('requires intentional replacement rationale and complete replacement proof', () => {
    const replacement = provenBehavior({
      status: 'intentional_replacement',
      replacement: {
        legacy_construct: 'Claude Stop hook',
        unified_construct: 'Kernel Attempt Supervisor',
      },
    });
    const result = validateBehaviorEquivalence(contract([replacement]), { now: NOW });

    expect(result.behaviors[0].effective_status).toBe('gap');
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'replacement_rationale_missing',
    }));
  });

  it('finds dangling supersession references and cycles', () => {
    const first = provenBehavior({
      behavior_id: 'B-FIRST',
      superseded_by: 'B-SECOND',
    });
    const second = provenBehavior({
      behavior_id: 'B-SECOND',
      superseded_by: 'B-FIRST',
    });
    const dangling = provenBehavior({
      behavior_id: 'B-DANGLING',
      superseded_by: 'B-MISSING',
    });

    const result = validateBehaviorEquivalence(contract([first, second, dangling]), { now: NOW });

    expect(result.findings).toContainEqual(expect.objectContaining({
      behavior_id: 'B-DANGLING',
      code: 'supersession_target_missing',
    }));
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: 'supersession_cycle',
    }));
    expect(result.behaviors.every((behavior) => behavior.effective_status === 'gap')).toBe(true);
  });
});

describe('deriveFamilyEffectiveStatus', () => {
  const proven = (classification = 'active_required') => ({
    classification,
    effective_status: 'proven',
  });
  const replacement = {
    classification: 'intentional_replacement',
    effective_status: 'proven',
  };
  const retired = (retiredAbsenceCurrent) => ({
    classification: 'retired',
    effective_status: 'retired',
    retired_absence_current: retiredAbsenceCurrent,
  });

  it('keeps a family gap when any proof-required atom is a gap', () => {
    expect(deriveFamilyEffectiveStatus([
      proven(),
      { classification: 'drifted_required_gap', effective_status: 'gap' },
    ])).toBe('gap');
  });

  it('requires current retired absence verification before a proven family', () => {
    expect(deriveFamilyEffectiveStatus([proven(), retired(false)])).toBe('gap');
    expect(deriveFamilyEffectiveStatus([proven(), retired(true)])).toBe('proven');
    expect(deriveFamilyEffectiveStatus([{
      classification: 'retired',
      effective_status: 'not_applicable',
      retired_absence_current: true,
    }])).toBe('gap');
  });

  it('marks only an all-replacement non-retired family as intentional replacement', () => {
    expect(deriveFamilyEffectiveStatus([replacement, replacement]))
      .toBe('intentional_replacement');
    expect(deriveFamilyEffectiveStatus([proven(), replacement]))
      .toBe('proven');
    expect(deriveFamilyEffectiveStatus([{
      classification: 'active_required',
      effective_status: 'intentional_replacement',
    }])).toBe('gap');
  });

  it('treats a verified mix of active, drifted, and replacement atoms as proven', () => {
    expect(deriveFamilyEffectiveStatus([
      proven('active_required'),
      proven('drifted_required_gap'),
      replacement,
      retired(true),
    ])).toBe('proven');
  });
});

describe('evidence envelope and journey projection', () => {
  it('builds one exact envelope per provider/scenario without inventing missing values', () => {
    const behavior = provenBehavior();
    behavior.proof_matrix.grok.recovery.effect_receipt_id = undefined;
    const result = validateBehaviorEquivalence(contract([behavior]), { now: NOW });
    const envelopes = buildEvidenceEnvelopes(result).filter(
      (item) => item.behavior_id === behavior.behavior_id,
    );

    expect(envelopes).toHaveLength(9);
    expect(envelopes.find(
      (item) => item.provider === 'grok' && item.scenario === 'recovery',
    )).toMatchObject({
      behavior_id: behavior.behavior_id,
      priority: 'P0',
      artifact_sha: SHA,
      provider: 'grok',
      scenario: 'recovery',
      effect_receipt_id: null,
    });
  });

  it('projects proven evidence into existing journey_step_links cell vocabulary', () => {
    const trusted = trustedContract();
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });
    const cells = projectJourneyCells(result).filter(
      (cell) => cell.behavior_id === trusted.behavior.behavior_id,
    );

    expect(cells).toHaveLength(BEHAVIOR_DIMENSIONS.length);
    expect(cells[0]).toEqual(expect.objectContaining({
      step: 'S9',
      cell_kind: 'element',
      cell_status: 'green',
      assertion_ref: 'KERNEL-MERGE-AUTHORITY-01',
    }));
    expect(cells.every((cell) => cell.write_database === false)).toBe(true);
  });

  it('keeps the exact v1.0 journey projection shape', () => {
    const trusted = trustedContract();
    const result = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });
    const [cell] = projectJourneyCells(result);

    expect(Object.keys(cell)).toEqual([
      'journey_key',
      'behavior_id',
      'step',
      'dimension',
      'cell_kind',
      'cell_key',
      'cell_status',
      'assertion_ref',
      'reason',
      'write_database',
    ]);
    expect(cell).not.toHaveProperty('atom_na_reasons');
    expect(cell).not.toHaveProperty('na_reason');

    result.behaviors[0].atoms = [{
      invariant_id: 'UNTRUSTED-V1-ATOM',
      steps: ['S4'],
      dimensions: ['invariant'],
      effective_status: 'gap',
      projection: 'red',
    }];
    expect(Object.keys(projectJourneyCells(result)[0])).toEqual([
      'journey_key',
      'behavior_id',
      'step',
      'dimension',
      'cell_kind',
      'cell_key',
      'cell_status',
      'assertion_ref',
      'reason',
      'write_database',
    ]);
    expect(projectJourneyCells(result)[0]).not.toHaveProperty('atom_na_reasons');
    expect(projectJourneyCells(result)[0]).not.toHaveProperty('na_reason');
  });

  it('aggregates atomic axes into one worst-status family/step/dimension cell', () => {
    const cells = projectJourneyCells({
      schema_version: '1.1.0',
      journey: { key: 'kernel-harness-delivery' },
      behaviors: [{
        behavior_id: 'KERNEL-P0-TEST',
        assertion_id: 'KERNEL-TEST-01',
        atoms: [
          {
            invariant_id: 'ATOM-PROVEN',
            steps: ['S4'],
            dimensions: ['invariant'],
            effective_status: 'proven',
            projection: 'green',
          },
          {
            invariant_id: 'ATOM-GAP',
            steps: ['S4'],
            dimensions: ['invariant'],
            effective_status: 'gap',
            projection: 'red',
          },
          {
            invariant_id: 'ATOM-RETIRED',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'retired',
            projection: 'na',
            retired_absence_current: false,
          },
        ],
      }],
    });

    expect(cells).toEqual([
      expect.objectContaining({
        step: 'S4',
        dimension: 'invariant',
        atom_ids: ['ATOM-GAP', 'ATOM-PROVEN'],
        atom_statuses: ['gap', 'proven'],
        atom_projections: ['red', 'green'],
        cell_status: 'red',
        write_database: false,
      }),
      expect.objectContaining({
        step: 'S12',
        dimension: 'checkpoint',
        atom_ids: ['ATOM-RETIRED'],
        atom_statuses: ['retired'],
        cell_status: 'red',
        write_database: false,
      }),
    ]);
  });

  it('deduplicates and canonically sorts atomic tuples per journey cell', () => {
    const cells = projectJourneyCells({
      schema_version: '1.1.0',
      journey: { key: 'kernel-harness-delivery' },
      behaviors: [{
        behavior_id: 'KERNEL-P0-TEST',
        atoms: [
          {
            invariant_id: 'ATOM-B',
            steps: ['S5', 'S4', 'S4'],
            dimensions: ['nfr', 'invariant'],
            effective_status: 'proven',
            projection: 'green',
          },
          {
            invariant_id: 'ATOM-A',
            steps: ['S4'],
            dimensions: ['invariant'],
            effective_status: 'gap',
            projection: 'red',
          },
          {
            invariant_id: 'ATOM-A',
            steps: ['S4'],
            dimensions: ['invariant'],
            effective_status: 'gap',
            projection: 'red',
          },
        ],
      }],
    });

    expect(cells.map(({ step, dimension }) => `${step}:${dimension}`)).toEqual([
      'S4:nfr',
      'S4:invariant',
      'S5:nfr',
      'S5:invariant',
    ]);
    expect(cells[1]).toMatchObject({
      atom_ids: ['ATOM-A', 'ATOM-B'],
      atom_statuses: ['gap', 'proven'],
      atom_projections: ['red', 'green'],
      cell_status: 'red',
    });
  });

  it('aligns per-atom N/A reasons and aggregates the compatibility scalar', () => {
    const duplicateReason = 'retired after durable closure migration';
    const cells = projectJourneyCells({
      schema_version: '1.1.0',
      journey: { key: 'kernel-harness-delivery' },
      behaviors: [{
        behavior_id: 'KERNEL-P1-TEST',
        atoms: [
          {
            invariant_id: 'ATOM-D',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'retired',
            projection: 'na',
            retired_absence_current: true,
            na_reason: 'archived by replacement proof',
          },
          {
            invariant_id: 'ATOM-B',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'retired',
            projection: 'na',
            retired_absence_current: true,
            na_reason: duplicateReason,
          },
          {
            invariant_id: 'ATOM-A',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'proven',
            projection: 'green',
          },
          {
            invariant_id: 'ATOM-C',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'retired',
            projection: 'na',
            retired_absence_current: true,
            na_reason: duplicateReason,
          },
          {
            invariant_id: 'ATOM-B',
            steps: ['S12'],
            dimensions: ['checkpoint'],
            effective_status: 'retired',
            projection: 'na',
            retired_absence_current: true,
            na_reason: duplicateReason,
          },
        ],
      }],
    });

    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      atom_ids: ['ATOM-A', 'ATOM-B', 'ATOM-C', 'ATOM-D'],
      atom_statuses: ['proven', 'retired', 'retired', 'retired'],
      atom_projections: ['green', 'na', 'na', 'na'],
      atom_na_reasons: [
        null,
        duplicateReason,
        duplicateReason,
        'archived by replacement proof',
      ],
      na_reason: 'archived by replacement proof; retired after durable closure migration',
    });
    expect(cells[0].atom_ids).toHaveLength(4);
    expect(cells[0].atom_statuses).toHaveLength(4);
    expect(cells[0].atom_projections).toHaveLength(4);
    expect(cells[0].atom_na_reasons).toHaveLength(4);
  });

  it('fails closed instead of emitting an unknown journey cell status', () => {
    const [cell] = projectJourneyCells({
      schema_version: '1.1.0',
      journey: { key: 'kernel-harness-delivery' },
      behaviors: [{
        behavior_id: 'KERNEL-P0-TEST',
        atoms: [{
          invariant_id: 'ATOM-UNKNOWN-PROJECTION',
          steps: ['S4'],
          dimensions: ['invariant'],
          effective_status: 'gap',
          projection: 'blue',
        }],
      }],
    });

    expect(cell.cell_status).toBe('red');
  });

  it('does not project the contract-only not_applicable proof status as atomic N/A', () => {
    const [cell] = projectJourneyCells({
      schema_version: '1.1.0',
      journey: { key: 'kernel-harness-delivery' },
      behaviors: [{
        behavior_id: 'KERNEL-P1-TEST',
        atoms: [{
          invariant_id: 'ATOM-INVALID-NOT-APPLICABLE',
          classification: 'retired',
          steps: ['S12'],
          dimensions: ['checkpoint'],
          effective_status: 'not_applicable',
          projection: 'na',
          retired_absence_current: true,
          na_reason: 'untrusted reason',
        }],
      }],
    });

    expect(cell).toMatchObject({
      cell_status: 'red',
      atom_statuses: ['not_applicable'],
      atom_projections: ['red'],
      atom_na_reasons: [null],
      na_reason: null,
    });
  });

  it('projects all 43 honest atomic invariants by their declared axes without writes', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const cells = projectJourneyCells(validation);
    const projectedAtomIds = new Set(cells.flatMap((cell) => cell.atom_ids));
    const uniqueCellKeys = new Set(cells.map(
      (cell) => `${cell.behavior_id}:${cell.step}:${cell.dimension}`,
    ));

    expect(projectedAtomIds.size).toBe(43);
    expect(uniqueCellKeys.size).toBe(cells.length);
    expect(cells.every((cell) => (
      Array.isArray(cell.atom_statuses)
      && cell.cell_status === 'red'
      && typeof cell.reason === 'string'
      && cell.reason.length > 0
      && cell.write_database === false
    ))).toBe(true);
    const retiredCells = cells.filter((cell) => (
      cell.atom_ids.includes('KERNEL-INV-P1-08-01')
    ));
    expect(retiredCells.length).toBeGreaterThan(0);
    expect(retiredCells.every((cell) => (
      cell.cell_status === 'red'
      && cell.atom_projections.includes('na')
      && cell.atom_na_reasons.some((reason) => (
        reason?.includes('durable goal/Attempt closure') === true
      ))
      && cell.na_reason.includes('durable goal/Attempt closure')
      && cell.reason.includes('retired absence proof is not verified')
    ))).toBe(true);
  });
});

describe('honest equivalence report', () => {
  it('reports the root atomic inventory without claiming unverified proof', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });

    expect(report).toMatchObject({
      report_version: '1.1.0',
      schema_valid: true,
      proof_complete: false,
      atomic_cutover_ready: false,
      atomic_summary: {
        classified: 43,
        proof_required: 42,
        probe_definitions: 446,
        proof_required_probe_definitions: 442,
        proven: 0,
        gap: 42,
        classification_counts: {
          active_required: 17,
          drifted_required_gap: 23,
          intentional_replacement: 2,
          retired: 1,
        },
        retired_absence_fresh: 0,
        retired_absence_required: 4,
        atom_scenario_required: 378,
        cell_scenario_probe_obligation_required: 1371,
        provider_probe_required: 1326,
        provider_probe_proven: 0,
        probe_outcome_authority: {
          appendix_explicit: 446,
          design_derived: 0,
          coverage_gap: 0,
        },
        recovery_mapping: {
          exact_binding_count: 56,
          derived_binding_count: 0,
          coverage_gap_count: 11,
        },
      },
      provider_matrix: {
        required_cells: 99,
        legacy_verified_family_receipts: 0,
        atomic_proven_family_cells: 0,
        receipted_cells: 0,
        missing_cells: 99,
      },
    });
    expect(report.cell_atomic_coverage).toHaveLength(99);
    expect(report.cell_atomic_coverage[0]).toEqual({
      cell_id:
        'KERNEL-P0-01-BRANCH-PROTECTION::claude::normal',
      expected_invariant_ids: [
        'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION',
        'KERNEL-INV-P0-01-02-MAIN-CHECKOUT-MUTATION-DENIAL',
        'KERNEL-INV-P0-01-03-COMMIT-ADMISSION',
        'KERNEL-INV-P0-01-04-GUARD-SELF-PROTECTION-AND-PATH-CONTAINMENT',
      ],
      configured_invariant_ids: [],
      live_proven_invariant_ids: [],
      missing_invariant_ids: [
        'KERNEL-INV-P0-01-01-WORKSPACE-WRITE-ADMISSION',
        'KERNEL-INV-P0-01-02-MAIN-CHECKOUT-MUTATION-DENIAL',
        'KERNEL-INV-P0-01-03-COMMIT-ADMISSION',
        'KERNEL-INV-P0-01-04-GUARD-SELF-PROTECTION-AND-PATH-CONTAINMENT',
      ],
      expected_probe_ids: [
        'KERNEL-PROBE-P0-01-01-001',
        'KERNEL-PROBE-P0-01-02-007',
        'KERNEL-PROBE-P0-01-03-001',
        'KERNEL-PROBE-P0-01-04-006',
      ],
      configured_probe_ids: [],
      live_proven_probe_ids: [],
      missing_probe_ids: [
        'KERNEL-PROBE-P0-01-01-001',
        'KERNEL-PROBE-P0-01-02-007',
        'KERNEL-PROBE-P0-01-03-001',
        'KERNEL-PROBE-P0-01-04-006',
      ],
    });
    expect(report.cell_atomic_coverage.map((cell) => cell.cell_id)).toEqual(
      [...report.cell_atomic_coverage]
        .map((cell) => cell.cell_id)
        .sort(),
    );
    expect(report.cell_atomic_coverage.reduce(
      (total, cell) => total + cell.expected_invariant_ids.length,
      0,
    )).toBe(378);
    expect(report.cell_atomic_coverage.reduce(
      (total, cell) => total + cell.expected_probe_ids.length,
      0,
    )).toBe(1371);
    expect(new Set(report.cell_atomic_coverage.flatMap((cell) => {
      const provider = cell.cell_id.split('::')[1];
      return cell.expected_probe_ids.map(
        (probeId) => `${provider}:${probeId}`,
      );
    })).size).toBe(1326);
    expect(report.cell_atomic_coverage.some((cell) => (
      cell.expected_probe_ids.some((probeId) => probeId.includes('-A0'))
    ))).toBe(false);

    const proofRequiredAtoms = validation.behaviors.flatMap(
      (behavior) => behavior.atomic_invariants,
    ).filter((atom) => atom.classification !== 'retired');
    const replayCount = proofRequiredAtoms.filter((atom) => {
      const normal = new Set(atom.scenario_plan.normal.required_probe_ids);
      return atom.scenario_plan.recovery.required_probe_ids.every(
        (probeId) => normal.has(probeId),
      );
    }).length;
    expect(replayCount).toBe(11);
    expect(proofRequiredAtoms).toHaveLength(replayCount + 31);
  });

  it('exposes fail-closed atom details, recovery gaps, and retirement absence', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });
    const replacement = report.atomic_details.find(
      (atom) => atom.classification === 'intentional_replacement',
    );
    const retired = report.atomic_details.find(
      (atom) => atom.classification === 'retired',
    );
    const recoveryGap = report.atomic_details.find(
      (atom) => atom.recovery_mapping_gap_count > 0,
    );

    expect(report.atomic_details).toHaveLength(43);
    expect(Object.keys(report.atomic_details[0])).toEqual([
      'behavior_id',
      'invariant_id',
      'classification',
      'proof_status',
      'effective_status',
      'artifact_sha',
      'receipt_v2_identity',
      'verified_at',
      'expires_at',
      'replacement_forbidden_authority_status',
      'retired_absence_probe_statuses',
      'recovery_mapping_gap_count',
      'recovery_mapping_gaps',
    ]);
    expect(report.atomic_details.every((atom) => (
      atom.artifact_sha === null
      && atom.receipt_v2_identity === null
      && atom.verified_at === null
      && atom.expires_at === null
      && atom.effective_status !== 'proven'
    ))).toBe(true);
    expect(replacement).toMatchObject({
      proof_status: 'gap',
      effective_status: 'gap',
      replacement_forbidden_authority_status: 'unverified',
    });
    expect(retired).toMatchObject({
      invariant_id: 'KERNEL-INV-P1-08-01',
      classification: 'retired',
      proof_status: 'not_applicable',
      effective_status: 'retired',
      replacement_forbidden_authority_status: null,
      retired_absence_probe_statuses: [
        { probe_id: 'KERNEL-PROBE-P1-08-01-A01', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A02', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A03', status: 'unverified' },
        { probe_id: 'KERNEL-PROBE-P1-08-01-A04', status: 'unverified' },
      ],
    });
    expect(recoveryGap.recovery_mapping_gaps).toEqual([
      expect.objectContaining({
        gap_id: expect.stringMatching(/^KERNEL-RECOVERY-GAP-/),
        affected_violation_probe_ids: expect.any(Array),
        affected_recovery_probe_ids: expect.any(Array),
      }),
    ]);
  });

  it('is byte-deterministic for a fixed validation and evaluation clock', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const options = { evaluatedAt: '2026-07-28T12:00:00.000Z' };
    const first = buildEquivalenceReport(validation, options);
    const second = buildEquivalenceReport(validation, options);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(formatEquivalenceMarkdown(second)).toBe(
      formatEquivalenceMarkdown(first),
    );

    const shuffled = structuredClone(validation);
    shuffled.behaviors.reverse();
    for (const behavior of shuffled.behaviors) {
      behavior.atomic_invariants?.reverse();
      behavior.atoms?.reverse();
    }
    expect(JSON.stringify(buildEquivalenceReport(shuffled, options))).toBe(
      JSON.stringify(first),
    );
  });

  it('distinguishes configured legacy receipt IDs from verified receipts', () => {
    const atomicContract = rootContract();
    atomicContract.behavior_equivalence.behaviors[0].proof_matrix =
      completeMatrix();
    const validation = validateBehaviorEquivalence(atomicContract, { now: NOW });
    const report = buildEquivalenceReport(validation);

    expect(report.provider_matrix.receipted_cells).toBeGreaterThan(0);
    expect(report.provider_matrix.legacy_verified_family_receipts).toBe(0);
    expect(report.provider_matrix.atomic_proven_family_cells).toBe(0);
  });

  it('preserves the exact legacy report and provider-matrix shape', () => {
    const report = buildEquivalenceReport(
      validateBehaviorEquivalence(contract(), { now: NOW }),
    );

    expect(Object.keys(report)).toEqual([
      'report_version',
      'contract_version',
      'evaluated_at',
      'valid',
      'summary',
      'axes',
      'provider_matrix',
      'proven_to_fire_commands',
      'gaps',
      'behaviors',
    ]);
    expect(Object.keys(report.provider_matrix)).toEqual([
      'required_cells',
      'receipted_cells',
      'missing_cells',
      'cells',
    ]);
    expect(Object.keys(report.provider_matrix.cells[0])).toEqual([
      'provider',
      'scenario',
      'required',
      'receipted',
      'missing',
    ]);
    expect(Object.keys(report.behaviors[0])).toEqual([
      'behavior_id',
      'priority',
      'claimed_status',
      'effective_status',
      'steps',
      'dimensions',
      'verified_at',
      'expires_at',
      'assertion_id',
      'legacy_behavior',
      'legacy_evidence',
      'unified_constructs',
      'failure_semantics',
      'partial_behavioral_evidence',
    ]);
    const markdown = formatEquivalenceMarkdown(report);
    expect(markdown).not.toContain('Atomic');
    expect(markdown).not.toContain('atomic proof');

    for (const invalid of [
      buildEquivalenceReport(null),
      buildEquivalenceReport({ valid: false, schema_version: 'hostile' }),
    ]) {
      expect(invalid.report_version).toBe('1.0.0');
      expect(Object.keys(invalid)).toEqual(Object.keys(report));
      expect(Object.keys(invalid.provider_matrix)).toEqual(
        Object.keys(report.provider_matrix),
      );
      expect(formatEquivalenceMarkdown(invalid)).not.toContain('Atomic');
    }
  });

  it('fails closed without throwing for missing or hostile validation input', () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error('hostile validation accessor');
      },
    });

    expect(() => buildEquivalenceReport(hostile)).not.toThrow();
    expect(buildEquivalenceReport(hostile)).toMatchObject({
      report_version: '1.0.0',
      valid: false,
    });
    expect(buildEquivalenceReport(hostile)).not.toHaveProperty(
      'atomic_summary',
    );
    expect(buildEquivalenceReport(null)).toMatchObject({
      report_version: '1.0.0',
      valid: false,
    });

    const invalid = validateBehaviorEquivalence(rootContract(), { now: NOW });
    invalid.valid = false;
    invalid.schema_valid = false;
    expect(buildEquivalenceReport(invalid)).toMatchObject({
      atomic_summary: {
        classified: 0,
        proof_required: 0,
        probe_definitions: 0,
        provider_probe_required: 0,
      },
      cell_atomic_coverage: [],
      atomic_details: [],
      provider_matrix: {
        required_cells: 99,
        atomic_proven_family_cells: 0,
      },
    });
  });

  it('does not copy caller-supplied atomic proof claims into the report', () => {
    const fabricated = validateBehaviorEquivalence(rootContract(), {
      now: NOW,
    });
    fabricated.proof_complete = true;
    fabricated.atomic_cutover_ready = true;
    fabricated.atomic_proven_family_cell_count = 999;

    const report = buildEquivalenceReport(fabricated);
    expect(report).toMatchObject({
      proof_complete: false,
      atomic_cutover_ready: false,
      provider_matrix: {
        atomic_proven_family_cells: 0,
      },
      atomic_summary: {
        proven: 0,
        provider_probe_proven: 0,
      },
    });
    expect(report.cell_atomic_coverage.every((cell) => (
      cell.configured_invariant_ids.length === 0
      && cell.live_proven_invariant_ids.length === 0
      && cell.configured_probe_ids.length === 0
      && cell.live_proven_probe_ids.length === 0
    ))).toBe(true);
    expect(report.atomic_details.every(
      (atom) => atom.effective_status !== 'proven',
    )).toBe(true);
  });

  it('bounds nested validation arrays before report projection', () => {
    const oversized = validateBehaviorEquivalence(rootContract(), {
      now: NOW,
    });
    const behavior = oversized.behaviors[0];
    const atom = behavior.atoms[0];
    behavior.legacy_evidence = Array(1_000).fill('legacy');
    behavior.partial_behavioral_evidence = Array(1_000).fill('partial');
    behavior.findings = Array(1_000).fill({ code: 'fabricated' });
    atom.steps = Array(100).fill('S4');
    atom.dimensions = Array(100).fill('invariant');
    atom.retired_absence_probe_statuses = Array(1_000).fill({
      probe_id: 'fabricated',
      status: 'verified',
    });

    const report = buildEquivalenceReport(oversized);

    expect(report.behaviors[0].legacy_evidence.length).toBeLessThanOrEqual(64);
    expect(
      report.behaviors[0].partial_behavioral_evidence.length,
    ).toBeLessThanOrEqual(64);
    expect(report.summary.findings).toBeLessThanOrEqual(64);
    expect(report.axes.grid).toHaveLength(13);
    expect(report.atomic_details).toHaveLength(43);
  });

  it('accounts for priority, effective status, axes, matrix, fire commands, and gaps', () => {
    const gap = provenBehavior({
      behavior_id: 'KERNEL-P1-REPORT-CLOSURE',
      priority: 'P1',
      status: 'gap',
      steps: ['S12'],
      dimensions: ['ledger_freshness', 'axis_alignment'],
      proof_matrix: {},
      gap: {
        reason: 'No live production receipt exists.',
        owner: 'kernel.reports',
        closure_plan: 'Run the production closure drill.',
      },
    });
    const trusted = trustedContract([gap]);
    const validation = validateBehaviorEquivalence(trusted.contract, {
      now: NOW,
      readBundle: trusted.readBundle,
    });

    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });

    expect(report.summary).toEqual({
      total: 11,
      by_priority: { P0: 8, P1: 3 },
      by_effective_status: { proven: 1, gap: 10, intentional_replacement: 0 },
      findings: 0,
    });
    expect(report.axes).toMatchObject({
      steps: GOLDEN_PATH_STEPS,
      dimensions: BEHAVIOR_DIMENSIONS,
      providers: PROOF_PROVIDERS,
      scenarios: PROOF_SCENARIOS,
      possible_cells: 143,
    });
    expect(report.provider_matrix).toMatchObject({
      required_cells: 99,
      receipted_cells: 9,
      missing_cells: 90,
    });
    expect(report.proven_to_fire_commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        behavior_id: 'KERNEL-P0-MERGE-AUTHORITY',
        provider: 'claude',
        scenario: 'violation',
      }),
    ]));
    expect(report.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-REPORT-CLOSURE',
        owner: 'kernel.reports',
        closure_plan: 'Run the production closure drill.',
      }),
    ]));
  });

  it('renders deterministic Markdown that says gaps are not proof', () => {
    const gap = provenBehavior({
      status: 'gap',
      proof_matrix: {},
      gap: {
        reason: 'No real Grok recovery receipt exists.',
        owner: 'kernel.fleet',
        closure_plan: 'Run the Grok recovery drill.',
      },
    });
    const validation = validateBehaviorEquivalence(contract([gap]), { now: NOW });
    const report = buildEquivalenceReport(validation, {
      evaluatedAt: '2026-07-28T12:00:00.000Z',
    });

    const first = formatEquivalenceMarkdown(report);
    const second = formatEquivalenceMarkdown(report);

    expect(second).toBe(first);
    expect(first).toContain('11 项行为维度');
    expect(first).toContain('缺口不是证明');
    expect(first).toContain('No real Grok recovery receipt exists.');
    expect(first).toContain('Run the Grok recovery drill.');
  });

  it('renders atomic progress, all cells, and proof identities explicitly', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const markdown = formatEquivalenceMarkdown(buildEquivalenceReport(
      validation,
      { evaluatedAt: '2026-07-28T12:00:00.000Z' },
    ));

    for (const text of [
      '43/43',
      '42 proof-required',
      '446/442',
      '17/23/2/1',
      '0/378',
      '0/1326',
      '0/4',
      '0/99',
      '11/11 family gaps',
      'v1 family receipt不是atomic proof',
      'replacement forbidden authority',
      'retired absence',
      'artifact SHA',
      'receipt v2 identity',
      'freshness',
      'KERNEL-P0-01-BRANCH-PROTECTION::claude::normal',
      'KERNEL-P1-11-REPORT-LEARNING-CLOSURE::grok::violation',
    ]) {
      expect(markdown).toContain(text);
    }
    expect(markdown.match(/^\| KERNEL-.*::.* \|/gm)).toHaveLength(99);
  });

  it('bounds and sanitizes hostile formatter input', () => {
    const validation = validateBehaviorEquivalence(rootContract(), { now: NOW });
    const report = buildEquivalenceReport(validation);
    const oversized = structuredClone(report);
    oversized.cell_atomic_coverage = Array(1_000).fill(
      report.cell_atomic_coverage[0],
    );
    oversized.atomic_details = Array(1_000).fill({
      ...report.atomic_details[0],
      invariant_id: 'KERNEL-INV-WITH\r\nLINE',
    });
    oversized.behaviors = Array(1_000).fill(report.behaviors[0]);

    const markdown = formatEquivalenceMarkdown(oversized);

    expect(markdown.match(/^\| KERNEL-.*::.* \|/gm)).toHaveLength(99);
    expect(markdown.match(/^\| KERNEL-INV-WITH LINE \|/gm)).toHaveLength(43);
    expect(markdown).not.toContain('\r');
    expect(() => formatEquivalenceMarkdown(new Proxy({}, {
      get() {
        throw new Error('hostile formatter accessor');
      },
    }))).not.toThrow();
  });
});
