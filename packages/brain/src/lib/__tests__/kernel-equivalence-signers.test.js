import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  generateKeyPairSync,
} from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  verifyExecutionGrant,
  verifyReceiptBundle,
} from '../kernel-equivalence-receipts.js';
import {
  loadCollectorSigner,
  loadExecutionGrantAuthority,
} from '../kernel-equivalence-signers.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  FIXTURE_SHA,
  createTrustFixture,
  fixtureCell,
  fixtureReceipt,
} from './kernel-equivalence-test-fixtures.js';

const roots = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'kernel-eq-signer-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

function writePrivateKey(root, name, privateKey, mode = 0o600) {
  const path = join(root, name);
  writeFileSync(
    path,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode },
  );
  chmodSync(path, mode);
  return path;
}

function grantInput(cell) {
  return {
    cell,
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    artifact_sha: FIXTURE_SHA,
    brain_version: '1.268.8',
    engine_version: '19.7.1',
    resource_id: `eq-${FIXTURE_ATTEMPT_ID}`,
    resource_ref:
      `refs/heads/equivalence-drill/${FIXTURE_RUN_ID}/${FIXTURE_ATTEMPT_ID}/case`,
    ttl_seconds: 300,
  };
}

function expected(cell, grant) {
  return {
    cell,
    run_id: grant.run_id,
    attempt_id: grant.attempt_id,
    artifact_sha: grant.artifact_sha,
    brain_version: grant.brain_version,
    engine_version: grant.engine_version,
    grant_id: grant.grant_id,
    nonce: grant.nonce,
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    resource_prefix: grant.resource_prefix,
  };
}

describe('protected Ed25519 equivalence signers', () => {
  it('loads the grant authority from a protected file and issues an exact verified grant', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = writePrivateKey(
      root,
      'grant-authority.pem',
      keys.authority.privateKey,
    );
    const cell = {
      ...fixtureCell(),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    let sequence = 0;
    const ids = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const authority = loadExecutionGrantAuthority({
      secretFile,
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      randomUUID: () => ids[sequence++],
    });

    const grant = authority.issue(grantInput(cell));

    expect(grant).toMatchObject({
      schema_version: 'kernel-equivalence-execution-grant/v1',
      grant_id: ids[0],
      nonce: ids[1],
      key_id: keys.authority.record.key_id,
      issued_at: new Date(FIXTURE_NOW).toISOString(),
      expires_at: new Date(FIXTURE_NOW + 300_000).toISOString(),
      scopes: ['isolated_effect'],
      environment: 'isolated',
    });
    expect(verifyExecutionGrant(
      grant,
      keys.registry,
      expected(cell, grant),
      { now: FIXTURE_NOW },
    )).toEqual(grant);
    expect(JSON.stringify(authority)).toBe(JSON.stringify({
      key_id: keys.authority.record.key_id,
      purpose: 'execution_grant',
      service_id: 'brain.authority',
    }));
    expect(JSON.stringify(authority)).not.toContain(secretFile);
    expect(JSON.stringify(authority)).not.toMatch(/PRIVATE KEY/);
  });

  it('loads a separate collector key and emits a verifiable bundle', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = writePrivateKey(
      root,
      'collector.pem',
      keys.collector.privateKey,
    );
    const collector = loadCollectorSigner({
      secretFile,
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    const cell = {
      ...fixtureCell(),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const authorityFile = writePrivateKey(
      root,
      'authority.pem',
      keys.authority.privateKey,
    );
    const authority = loadExecutionGrantAuthority({
      secretFile: authorityFile,
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    const grant = authority.issue(grantInput(cell));
    const receipt = fixtureReceipt(keys, grant, cell, null, {
      brain_version: grant.brain_version,
      engine_version: grant.engine_version,
      issued_at: new Date(FIXTURE_NOW - 30_000).toISOString(),
      expires_at: new Date(FIXTURE_NOW + 3_600_000).toISOString(),
    });

    const bundle = await collector({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [receipt],
      previousBundleHash: null,
    });

    expect(verifyReceiptBundle(
      bundle,
      keys.registry,
      expected(cell, grant),
      { now: FIXTURE_NOW },
    )).toMatchObject({
      bundle_id: bundle.bundle_id,
      receipt_ids: [receipt.receipt_id],
    });
    expect(JSON.stringify(collector)).not.toContain(secretFile);
    expect(JSON.stringify(collector)).not.toMatch(/PRIVATE KEY/);
  });

  it.each([
    ['relative path', ({ keys }) => 'relative-key.pem', 'signer_secret_path_invalid'],
    ['directory', ({ root }) => {
      const path = join(root, 'directory');
      mkdirSync(path);
      return path;
    }, 'signer_secret_file_unsafe'],
    ['group-readable mode', ({ root, keys }) => (
      writePrivateKey(root, 'mode.pem', keys.authority.privateKey, 0o640)
    ), 'signer_secret_permissions_invalid'],
    ['empty file', ({ root }) => {
      const path = join(root, 'empty.pem');
      writeFileSync(path, '', { mode: 0o600 });
      return path;
    }, 'signer_secret_size_invalid'],
    ['oversized file', ({ root }) => {
      const path = join(root, 'large.pem');
      writeFileSync(path, 'x'.repeat(9000), { mode: 0o600 });
      return path;
    }, 'signer_secret_size_invalid'],
    ['non-Ed25519 key', ({ root }) => {
      const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
      return writePrivateKey(root, 'rsa.pem', pair.privateKey);
    }, 'signer_private_key_invalid'],
  ])('rejects an unsafe grant secret source: %s', (_label, source, code) => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = source({ root, keys });

    expect(() => loadExecutionGrantAuthority({
      secretFile,
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    })).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects symlinks and hard links without following either source', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const actual = writePrivateKey(
      root,
      'actual.pem',
      keys.authority.privateKey,
    );
    const symlink = join(root, 'linked.pem');
    symlinkSync(actual, symlink);
    const hardLink = join(root, 'hard.pem');
    linkSync(actual, hardLink);

    for (const secretFile of [symlink, hardLink]) {
      expect(() => loadExecutionGrantAuthority({
        secretFile,
        keyId: keys.authority.record.key_id,
        trustRegistry: keys.registry,
        now: () => FIXTURE_NOW,
      })).toThrowError(expect.objectContaining({
        code: 'signer_secret_file_unsafe',
      }));
    }
  });

  it.each([
    ['unknown key', (keys) => 'missing-key', 'signer_registry_key_invalid'],
    ['wrong purpose', (keys) => keys.effect.record.key_id, 'signer_registry_key_invalid'],
    ['revoked key', (keys) => {
      keys.authority.record.revoked_at = new Date(FIXTURE_NOW - 1).toISOString();
      return keys.authority.record.key_id;
    }, 'signer_registry_key_inactive'],
    ['future key', (keys) => {
      keys.authority.record.not_before = new Date(FIXTURE_NOW + 1).toISOString();
      return keys.authority.record.key_id;
    }, 'signer_registry_key_inactive'],
  ])('rejects invalid public registry lifecycle metadata: %s', (
    _label,
    mutate,
    code,
  ) => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const secretFile = writePrivateKey(
      root,
      'authority.pem',
      keys.authority.privateKey,
    );
    const keyId = mutate(keys);

    expect(() => loadExecutionGrantAuthority({
      secretFile,
      keyId,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    })).toThrowError(expect.objectContaining({ code }));
  });

  it('rejects a private key that does not match the exact registry public key', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const other = generateKeyPairSync('ed25519');
    const secretFile = writePrivateKey(root, 'wrong.pem', other.privateKey);

    expect(() => loadExecutionGrantAuthority({
      secretFile,
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    })).toThrowError(expect.objectContaining({
      code: 'signer_public_key_mismatch',
    }));
  });
});
