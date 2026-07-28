import {
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
} from 'node:crypto';
import {
  assembleUnsignedBundle,
  canonicalJson,
  sha256Canonical,
} from '../kernel-equivalence-receipts.js';

export const FIXTURE_NOW = Date.parse('2026-07-28T12:02:00.000Z');
export const FIXTURE_SHA = '8e034654d196221ddca25a7f032612b526bad031';
export const FIXTURE_RUN_ID = '11111111-1111-4111-8111-111111111111';
export const FIXTURE_ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

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

export function createTrustFixture(
  seamId = 'kernel.merge.effect_executor',
) {
  const authority = keyPair('authority-2026-07', 'execution_grant', 'brain.authority');
  const effect = keyPair('effect-2026-07', 'effect_receipt', seamId);
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

export function fixtureCell({
  behaviorId = 'KERNEL-P0-MERGE-AUTHORITY',
  provider = 'codex',
  scenario = 'normal',
  seamId = 'kernel.merge.effect_executor',
  adapterId = 'kernel.drill.ci_merge_authority.v1',
} = {}) {
  return {
    cell_id: `${behaviorId}::${provider}::${scenario}`,
    behavior_id: behaviorId,
    provider,
    scenario,
    seam_id: seamId,
    adapter_id: adapterId,
    isolation: {
      environment: 'isolated',
      resource_type: 'ephemeral_branch',
      resource_prefix: 'refs/heads/equivalence-drill/{run_id}/{attempt_id}/',
    },
  };
}

export function signFixture(record, privateKey) {
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

export function fixtureExpected(cell, grant = null) {
  return {
    cell,
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    artifact_sha: FIXTURE_SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    grant_id: grant?.grant_id,
    nonce: grant?.nonce,
    resource_id: grant?.resource_id,
    resource_ref: grant?.resource_ref,
  };
}

export function fixtureGrant(keys, cell) {
  return signFixture({
    schema_version: 'kernel-equivalence-execution-grant/v1',
    grant_id: randomUUID(),
    key_id: keys.authority.record.key_id,
    issued_at: '2026-07-28T11:59:00.000Z',
    expires_at: '2026-07-28T12:05:00.000Z',
    nonce: randomUUID(),
    cell_id: cell.cell_id,
    behavior_id: cell.behavior_id,
    provider: cell.provider,
    scenario: cell.scenario,
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    artifact_sha: FIXTURE_SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    environment: 'isolated',
    resource_id: `eq-${FIXTURE_ATTEMPT_ID}`,
    resource_ref: `refs/heads/equivalence-drill/${FIXTURE_RUN_ID}/${FIXTURE_ATTEMPT_ID}/case`,
    resource_prefix: `refs/heads/equivalence-drill/${FIXTURE_RUN_ID}/${FIXTURE_ATTEMPT_ID}/`,
    seam_id: cell.seam_id,
    adapter_id: cell.adapter_id,
    scopes: ['isolated_effect'],
  }, keys.authority.privateKey);
}

export function fixtureReceipt(
  keys,
  grant,
  cell,
  predecessor = null,
) {
  const recovery = cell.scenario === 'recovery';
  return signFixture({
    schema_version: 'kernel-equivalence-effect-receipt/v1',
    receipt_id: randomUUID(),
    key_id: keys.effect.record.key_id,
    service_id: cell.seam_id,
    issued_at: '2026-07-28T12:00:30.000Z',
    expires_at: '2026-07-29T12:00:30.000Z',
    cell_id: cell.cell_id,
    behavior_id: cell.behavior_id,
    provider: cell.provider,
    scenario: cell.scenario,
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    grant_id: grant.grant_id,
    nonce: grant.nonce,
    artifact_sha: FIXTURE_SHA,
    brain_version: '1.268.7',
    engine_version: '1.42.0',
    environment: 'isolated',
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    seam_id: cell.seam_id,
    adapter_id: cell.adapter_id,
    execution_mode: 'live_effect',
    observed_outcome: recovery
      ? 'recovered'
      : cell.scenario === 'violation' ? 'denied' : 'confirmed',
    effect_code: recovery
      ? 'renewed_authority_merge_confirmed'
      : cell.scenario === 'violation'
        ? 'stale_sha_merge_denied'
        : 'exact_sha_merge_confirmed',
    before_hash: 'a'.repeat(64),
    after_hash: 'b'.repeat(64),
    predecessor_cell_id: predecessor?.cell_id ?? null,
    predecessor_receipt_id: predecessor?.receipt_id ?? null,
    predecessor_receipt_hash: predecessor ? sha256Canonical(predecessor) : null,
  }, keys.effect.privateKey);
}

export function fixtureBundle(keys, cell, grant, receipts) {
  const unsigned = assembleUnsignedBundle({
    keyId: keys.collector.record.key_id,
    collectorServiceId: keys.collector.record.service_id,
    issuedAt: '2026-07-28T12:01:00.000Z',
    expiresAt: '2026-07-29T12:01:00.000Z',
    expected: fixtureExpected(cell, grant),
    receipts,
    previousBundleHash: null,
  });
  return signFixture(unsigned, keys.collector.privateKey);
}
