import {
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assembleUnsignedBundle,
  canonicalJson,
  preloadReceiptBundleAncestry,
  sha256Canonical,
  validateTrustRegistry,
  verifyEffectReceipt,
  verifyExecutionGrant,
  verifyReceiptBundle,
} from '../kernel-equivalence-receipts.js';

const NOW = Date.parse('2026-07-28T12:02:00.000Z');
const SHA = '8e034654d196221ddca25a7f032612b526bad031';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function keyPair(keyId, purpose, serviceId) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    record: {
      key_id: keyId,
      purpose,
      service_id: serviceId,
      public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
      not_before: '2026-07-28T00:00:00.000Z',
      not_after: '2026-08-28T00:00:00.000Z',
      revoked_at: null,
      rotates_key_id: null,
    },
  };
}

function trustFixture() {
  const authority = keyPair('authority-2026-07', 'execution_grant', 'brain.authority');
  const effect = keyPair(
    'merge-effect-2026-07',
    'effect_receipt',
    'kernel.merge.effect_executor',
  );
  const collector = keyPair(
    'collector-2026-07',
    'collector_bundle',
    'kernel.equivalence.collector',
  );
  return {
    authority,
    effect,
    collector,
    registry: {
      schema_version: 'kernel-equivalence-trust-registry/v1',
      algorithm: 'ed25519',
      grant_max_age_seconds: 900,
      effect_receipt_max_age_seconds: 86400,
      collector_bundle_max_age_seconds: 86400,
      replay_nonce: {
        single_use: true,
        atomic_consumer_required: true,
      },
      keys: [authority.record, effect.record, collector.record],
    },
  };
}

function cell(scenario = 'normal') {
  return {
    cell_id: `KERNEL-P0-04-CI-MERGE-AUTHORITY::codex::${scenario}`,
    behavior_id: 'KERNEL-P0-04-CI-MERGE-AUTHORITY',
    provider: 'codex',
    scenario,
    seam_id: 'kernel.merge.effect_executor',
    adapter_id: 'kernel.drill.ci_merge_authority.v1',
    effect_key_id: 'merge-effect-2026-07',
    expected: {
      expected_outcome: scenario === 'recovery'
        ? 'recovered'
        : scenario === 'violation' ? 'denied' : 'confirmed',
      effect_code: scenario === 'recovery'
        ? 'renewed_authority_merge_confirmed'
        : scenario === 'violation'
          ? 'stale_sha_merge_denied'
          : 'exact_sha_merge_confirmed',
    },
    isolation: {
      environment: 'isolated',
      resource_type: 'ephemeral_branch',
      resource_prefix: 'refs/heads/equivalence-drill/{run_id}/{attempt_id}/',
    },
  };
}

function signed(record, privateKey) {
  const unsigned = structuredClone(record);
  delete unsigned.signature;
  return {
    ...unsigned,
    signature: signBytes(
      null,
      Buffer.from(canonicalJson(unsigned), 'utf8'),
      privateKey,
    ).toString('base64'),
  };
}

function grant(keys, target = cell()) {
  return signed({
    schema_version: 'kernel-equivalence-execution-grant/v1',
    grant_id: randomUUID(),
    key_id: keys.authority.record.key_id,
    issued_at: '2026-07-28T11:59:00.000Z',
    expires_at: '2026-07-28T12:05:00.000Z',
    nonce: randomUUID(),
    cell_id: target.cell_id,
    behavior_id: target.behavior_id,
    provider: target.provider,
    scenario: target.scenario,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    artifact_sha: SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    environment: 'isolated',
    resource_id: `eq-${ATTEMPT_ID}`,
    resource_ref: `refs/heads/equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/case`,
    resource_prefix: `refs/heads/equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/`,
    seam_id: target.seam_id,
    adapter_id: target.adapter_id,
    scopes: ['isolated_effect'],
  }, keys.authority.privateKey);
}

function effectReceipt(keys, executionGrant, target = cell(), overrides = {}) {
  return signed({
    schema_version: 'kernel-equivalence-effect-receipt/v1',
    receipt_id: randomUUID(),
    key_id: keys.effect.record.key_id,
    service_id: target.seam_id,
    issued_at: '2026-07-28T12:00:30.000Z',
    expires_at: '2026-07-29T12:00:30.000Z',
    cell_id: target.cell_id,
    behavior_id: target.behavior_id,
    provider: target.provider,
    scenario: target.scenario,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    grant_id: executionGrant.grant_id,
    nonce: executionGrant.nonce,
    artifact_sha: SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    environment: 'isolated',
    resource_id: executionGrant.resource_id,
    resource_ref: executionGrant.resource_ref,
    seam_id: target.seam_id,
    adapter_id: target.adapter_id,
    execution_mode: 'live_effect',
    observed_outcome: target.scenario === 'violation' ? 'denied' : 'confirmed',
    effect_code: target.scenario === 'violation'
      ? 'stale_sha_merge_denied'
      : 'exact_sha_merge_confirmed',
    before_hash: 'a'.repeat(64),
    after_hash: 'b'.repeat(64),
    predecessor_cell_id: null,
    predecessor_receipt_id: null,
    predecessor_receipt_hash: null,
    ...overrides,
  }, keys.effect.privateKey);
}

function expected(target = cell(), executionGrant = null) {
  return {
    cell: target,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    artifact_sha: SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    grant_id: executionGrant?.grant_id,
    nonce: executionGrant?.nonce,
    resource_id: executionGrant?.resource_id,
    resource_ref: executionGrant?.resource_ref,
    resource_prefix: executionGrant?.resource_prefix,
  };
}

describe('canonical signed envelopes', () => {
  it.each([NaN, Infinity, -Infinity, '2026-07-28'])(
    'rejects a non-finite numeric clock: %s',
    (now) => {
      const keys = trustFixture();
      const target = cell();
      const value = grant(keys, target);
      expect(() => verifyExecutionGrant(
        value,
        keys.registry,
        expected(target),
        { now },
      )).toThrowError(expect.objectContaining({ code: 'verification_time_invalid' }));
    },
  );

  it('uses deterministic recursive key ordering', () => {
    expect(canonicalJson({ z: 1, a: { d: 4, b: 2 }, c: [3, { y: 2, x: 1 }] }))
      .toBe('{"a":{"b":2,"d":4},"c":[3,{"x":1,"y":2}],"z":1}');
  });

  it('verifies an exact-axis, fresh execution grant', () => {
    const keys = trustFixture();
    const target = cell();
    const value = grant(keys, target);

    expect(verifyExecutionGrant(
      value,
      keys.registry,
      expected(target),
      { now: NOW },
    )).toMatchObject({
      grant_id: value.grant_id,
      cell_id: target.cell_id,
      nonce: value.nonce,
    });
  });

  it.each([
    ['unknown field', (value) => { value.debug = true; }, 'grant_fields_invalid'],
    ['axis mismatch', (value) => { value.provider = 'grok'; }, 'grant_axis_mismatch'],
    ['unsafe environment', (value) => { value.environment = 'production'; }, 'grant_environment_unsafe'],
    ['protected resource id', (value) => { value.resource_id = 'production'; }, 'grant_environment_unsafe'],
    ['protected token in resource id', (value) => { value.resource_id = 'eq:production'; }, 'grant_environment_unsafe'],
    ['path-like resource id', (value) => { value.resource_id = 'eq/case'; }, 'grant_environment_unsafe'],
    ['traversal resource ref', (value) => { value.resource_ref = `${value.resource_prefix}../../victim`; }, 'grant_environment_unsafe'],
    ['empty resource ref segment', (value) => { value.resource_ref = `${value.resource_prefix}case//victim`; }, 'grant_environment_unsafe'],
    ['expired grant', (value) => { value.expires_at = '2026-07-28T11:59:59.000Z'; }, 'grant_expired'],
  ])('rejects %s even when the object remains signed', (_label, mutate, code) => {
    const keys = trustFixture();
    const target = cell();
    const value = grant(keys, target);
    mutate(value);
    const resigned = signed(value, keys.authority.privateKey);

    expect(() => verifyExecutionGrant(
      resigned,
      keys.registry,
      expected(target),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects a revoked or wrong-purpose grant key', () => {
    const keys = trustFixture();
    const value = grant(keys);
    const revoked = structuredClone(keys.registry);
    revoked.keys[0].revoked_at = '2026-07-28T11:00:00.000Z';
    expect(() => verifyExecutionGrant(value, revoked, expected(), { now: NOW }))
      .toThrowError(expect.objectContaining({ code: 'grant_key_invalid' }));

    const wrongPurpose = structuredClone(keys.registry);
    wrongPurpose.keys[0].purpose = 'collector_bundle';
    wrongPurpose.keys[0].service_id = 'kernel.equivalence.collector';
    expect(() => verifyExecutionGrant(value, wrongPurpose, expected(), { now: NOW }))
      .toThrowError(expect.objectContaining({ code: 'grant_key_invalid' }));
  });

  it('rejects rotation cycles and cross-authority rotation edges', () => {
    const cycle = trustFixture();
    cycle.registry.keys[0].rotates_key_id = cycle.registry.keys[1].key_id;
    cycle.registry.keys[1].rotates_key_id = cycle.registry.keys[0].key_id;
    expect(() => validateTrustRegistry(cycle.registry))
      .toThrowError(expect.objectContaining({ code: 'trust_registry_invalid' }));

    const crossAuthority = trustFixture();
    crossAuthority.registry.keys[1].rotates_key_id =
      crossAuthority.registry.keys[2].key_id;
    expect(() => validateTrustRegistry(crossAuthority.registry))
      .toThrowError(expect.objectContaining({ code: 'trust_registry_invalid' }));
  });

  it('binds the effect receipt to the manifest-pinned signer key', () => {
    const current = trustFixture();
    const old = keyPair(
      'merge-effect-old',
      'effect_receipt',
      'kernel.merge.effect_executor',
    );
    current.registry.keys.push(old.record);
    const target = {
      ...cell(),
      effect_key_id: current.effect.record.key_id,
    };
    const executionGrant = grant(current, target);
    const receipt = effectReceipt(
      { ...current, effect: old },
      executionGrant,
      target,
    );

    expect(() => verifyEffectReceipt(
      receipt,
      current.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_key_invalid' }));
  });

  it('requires a live, seam-signed violation denial', () => {
    const keys = trustFixture();
    const target = cell('violation');
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);

    expect(verifyEffectReceipt(
      receipt,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toMatchObject({
      receipt_id: receipt.receipt_id,
      observed_outcome: 'denied',
    });

    const fake = effectReceipt(keys, executionGrant, target, {
      execution_mode: 'dry_run',
      observed_outcome: 'confirmed',
    });
    expect(() => verifyEffectReceipt(
      fake,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_outcome_invalid' }));
  });

  it('rejects effect unknown fields, tampering, and collector-key substitution', () => {
    const keys = trustFixture();
    const executionGrant = grant(keys);
    const receipt = effectReceipt(keys, executionGrant);

    const unknown = signed(
      { ...receipt, debug: 'not-allowed' },
      keys.effect.privateKey,
    );
    expect(() => verifyEffectReceipt(
      unknown,
      keys.registry,
      expected(cell(), executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_fields_invalid' }));

    expect(() => verifyEffectReceipt(
      { ...receipt, after_hash: 'c'.repeat(64) },
      keys.registry,
      expected(cell(), executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_signature_invalid' }));

    const collectorSigned = signed(
      { ...receipt, key_id: keys.collector.record.key_id },
      keys.collector.privateKey,
    );
    expect(() => verifyEffectReceipt(
      collectorSigned,
      keys.registry,
      expected(cell(), executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_key_invalid' }));
  });

  it('rejects a seam-signed effect that targets a protected resource id', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = {
      ...grant(keys, target),
      resource_id: 'production',
    };
    const receipt = effectReceipt(keys, executionGrant, target);

    expect(() => verifyEffectReceipt(
      receipt,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({
      code: 'effect_outcome_invalid',
    }));
  });
});

describe('receipt bundle and recovery lineage', () => {
  it('preloads committed ancestry after its execution grant has expired', async () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: expected(target, executionGrant),
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: null,
    });
    const bundle = signed(unsigned, keys.collector.privateKey);
    const bundleHash = sha256Canonical(bundle);
    const afterGrantExpiry = Date.parse('2026-07-28T12:06:00.000Z');

    expect(() => verifyReceiptBundle(
      bundle,
      keys.registry,
      expected(target, executionGrant),
      { now: afterGrantExpiry },
    )).toThrowError(expect.objectContaining({ code: 'grant_expired' }));

    await expect(preloadReceiptBundleAncestry({
      headHash: bundleHash,
      genesisHash: bundleHash,
      readBundle: async (hash) => (hash === bundleHash ? bundle : null),
      trustRegistry: keys.registry,
      now: afterGrantExpiry,
    })).resolves.toMatchObject({
      head_hash: bundleHash,
      genesis_hash: bundleHash,
      bundle_hashes: [bundleHash],
    });
  });

  it('requires recovery to reference the matching violation cell receipt id and hash', () => {
    const keys = trustFixture();
    const violationCell = cell('violation');
    const recoveryCell = cell('recovery');
    const violationGrant = grant(keys, violationCell);
    const recoveryGrant = grant(keys, recoveryCell);
    const violation = effectReceipt(keys, violationGrant, violationCell);
    const recovery = effectReceipt(keys, recoveryGrant, recoveryCell, {
      observed_outcome: 'recovered',
      effect_code: 'renewed_authority_merge_confirmed',
      predecessor_cell_id: violationCell.cell_id,
      predecessor_receipt_id: violation.receipt_id,
      predecessor_receipt_hash: sha256Canonical(violation),
    });

    expect(verifyEffectReceipt(
      recovery,
      keys.registry,
      {
        ...expected(recoveryCell, recoveryGrant),
        predecessor: violation,
      },
      { now: NOW },
    )).toMatchObject({ observed_outcome: 'recovered' });

    const wrongLineage = effectReceipt(keys, recoveryGrant, recoveryCell, {
      observed_outcome: 'recovered',
      effect_code: 'renewed_authority_merge_confirmed',
      predecessor_cell_id: recoveryCell.cell_id,
      predecessor_receipt_id: violation.receipt_id,
      predecessor_receipt_hash: sha256Canonical(violation),
    });
    expect(() => verifyEffectReceipt(
      wrongLineage,
      keys.registry,
      {
        ...expected(recoveryCell, recoveryGrant),
        predecessor: violation,
      },
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'recovery_lineage_invalid' }));
  });

  it('verifies both seam receipts before accepting the collector-signed hash chain', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: expected(target, executionGrant),
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: null,
    });
    const bundle = signed(unsigned, keys.collector.privateKey);

    expect(verifyReceiptBundle(
      bundle,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toMatchObject({
      bundle_id: unsigned.bundle_id,
      receipt_ids: [receipt.receipt_id],
      grant_ids: [executionGrant.grant_id],
    });

    const brokenChain = signed({
      ...unsigned,
      receipt_hashes: ['f'.repeat(64)],
    }, keys.collector.privateKey);
    expect(() => verifyReceiptBundle(
      brokenChain,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'bundle_hash_chain_invalid' }));
  });

  it('rejects collector unknown fields and a valid collector envelope around an invalid seam receipt', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: expected(target, executionGrant),
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: null,
    });

    const unknown = signed(
      { ...unsigned, debug: true },
      keys.collector.privateKey,
    );
    expect(() => verifyReceiptBundle(
      unknown,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'bundle_fields_invalid' }));

    const invalidEffect = { ...receipt, observed_outcome: 'denied' };
    const wrapped = signed({
      ...unsigned,
      effect_receipts: [invalidEffect],
      receipt_hashes: [sha256Canonical(invalidEffect)],
    }, keys.collector.privateKey);
    expect(() => verifyReceiptBundle(
      wrapped,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'effect_signature_invalid' }));
  });

  it('re-verifies the signed execution grant carried by the bundle', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: expected(target, executionGrant),
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: null,
    });

    expect(unsigned.execution_grants).toEqual([executionGrant]);
    const forgedGrant = {
      ...executionGrant,
      resource_ref: `${executionGrant.resource_prefix}forged`,
    };
    const wrapped = signed({
      ...unsigned,
      execution_grants: [forgedGrant],
    }, keys.collector.privateKey);
    expect(() => verifyReceiptBundle(
      wrapped,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'grant_signature_invalid' }));
  });

  it('binds each effect resource exactly to its verified execution grant', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const forgedResource = `${executionGrant.resource_prefix}other`;
    const receipt = effectReceipt(keys, executionGrant, target, {
      resource_id: 'eq-forged',
      resource_ref: forgedResource,
    });
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: {
        ...expected(target, executionGrant),
        resource_id: 'eq-forged',
        resource_ref: forgedResource,
      },
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: null,
    });
    const wrapped = signed(unsigned, keys.collector.privateKey);

    expect(() => verifyReceiptBundle(
      wrapped,
      keys.registry,
      {
        ...expected(target, executionGrant),
        resource_id: 'eq-forged',
        resource_ref: forgedResource,
      },
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'bundle_axis_mismatch' }));
  });

  it('rejects an unresolvable previous bundle hash instead of claiming a chain', () => {
    const keys = trustFixture();
    const target = cell();
    const executionGrant = grant(keys, target);
    const receipt = effectReceipt(keys, executionGrant, target);
    const unsigned = assembleUnsignedBundle({
      keyId: keys.collector.record.key_id,
      collectorServiceId: keys.collector.record.service_id,
      issuedAt: '2026-07-28T12:01:00.000Z',
      expiresAt: '2026-07-29T12:01:00.000Z',
      expected: expected(target, executionGrant),
      executionGrants: [executionGrant],
      receipts: [receipt],
      previousBundleHash: 'f'.repeat(64),
    });
    const wrapped = signed(unsigned, keys.collector.privateKey);

    expect(() => verifyReceiptBundle(
      wrapped,
      keys.registry,
      expected(target, executionGrant),
      { now: NOW },
    )).toThrowError(expect.objectContaining({ code: 'bundle_previous_unresolved' }));
  });
});
