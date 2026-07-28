import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  generateKeyPairSync,
} from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  sha256Canonical,
  verifyEffectReceipt,
  verifyExecutionGrant,
  verifyReceiptBundle,
} from '../kernel-equivalence-receipts.js';
import {
  loadCollectorSigner,
  loadEffectReceiptSigner,
  loadExecutionGrantAuthority,
} from '../kernel-equivalence-signers.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  FIXTURE_SHA,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureCleanupEvidence,
  fixtureGrant,
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
    brain_version: '1.268.7',
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
  it.runIf(process.platform === 'darwin')(
    'rejects an ACL-bearing private key even when mode is 0600',
    () => {
      const root = temporaryRoot();
      const keys = createTrustFixture();
      const secretFile = writePrivateKey(
        root,
        'acl-grant-authority.pem',
        keys.authority.privateKey,
      );
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow read',
        secretFile,
      ]);

      expect(() => loadExecutionGrantAuthority({
        secretFile,
        keyId: keys.authority.record.key_id,
        trustRegistry: keys.registry,
        now: () => FIXTURE_NOW,
      })).toThrowError(expect.objectContaining({
        code: 'signer_secret_permissions_invalid',
      }));
    },
  );

  it.runIf(
    process.platform === 'linux'
    && (
      existsSync('/usr/bin/setfacl')
      || existsSync('/bin/setfacl')
    ),
  )(
    'rejects a Linux ACL-bearing private key when setfacl is available',
    () => {
      const root = temporaryRoot();
      const keys = createTrustFixture();
      const secretFile = writePrivateKey(
        root,
        'acl-grant-authority.pem',
        keys.authority.privateKey,
      );
      const setfacl = existsSync('/usr/bin/setfacl')
        ? '/usr/bin/setfacl'
        : '/bin/setfacl';
      execFileSync(setfacl, ['-m', 'u:nobody:r', secretFile]);

      expect(() => loadExecutionGrantAuthority({
        secretFile,
        keyId: keys.authority.record.key_id,
        trustRegistry: keys.registry,
        now: () => FIXTURE_NOW,
      })).toThrowError(expect.objectContaining({
        code: 'signer_secret_permissions_invalid',
      }));
    },
  );

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

  it('refuses to issue an isolated grant for a protected resource id', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const authority = loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'grant-authority.pem',
        keys.authority.privateKey,
      ),
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });

    expect(() => authority.issue({
      ...grantInput(fixtureCell()),
      resource_id: 'production',
    })).toThrowError(expect.objectContaining({
      code: 'grant_environment_unsafe',
    }));

    expect(() => authority.issue({
      ...grantInput(fixtureCell()),
      resource_ref:
        `refs/heads/equivalence-drill/${FIXTURE_RUN_ID}/${FIXTURE_ATTEMPT_ID}/../../victim`,
    })).toThrowError(expect.objectContaining({
      code: 'grant_environment_unsafe',
    }));
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
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
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

  it('loads a seam-only signer that derives receipt axes from a verified grant', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const cell = {
      ...fixtureCell(),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const authority = loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'authority.pem',
        keys.authority.privateKey,
      ),
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    const effectSigner = loadEffectReceiptSigner({
      secretFile: writePrivateKey(root, 'effect.pem', keys.effect.privateKey),
      keyId: keys.effect.record.key_id,
      serviceId: cell.seam_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      randomUUID: () => '55555555-5555-4555-8555-555555555555',
    });
    const grant = authority.issue(grantInput(cell));

    const receipt = effectSigner.signEffectResult({
      cell,
      grant,
      observation: {
        observed_outcome: cell.expected.expected_outcome,
        effect_code: cell.expected.effect_code,
        before_hash: 'a'.repeat(64),
        after_hash: 'b'.repeat(64),
      },
      predecessor: null,
    });

    expect(receipt).toMatchObject({
      receipt_id: '55555555-5555-4555-8555-555555555555',
      key_id: keys.effect.record.key_id,
      service_id: cell.seam_id,
      grant_id: grant.grant_id,
      nonce: grant.nonce,
      cell_id: cell.cell_id,
      resource_id: grant.resource_id,
    });
    expect(verifyEffectReceipt(
      receipt,
      keys.registry,
      expected(cell, grant),
      { now: FIXTURE_NOW },
    )).toEqual(receipt);
    expect(effectSigner).toMatchObject({
      key_id: keys.effect.record.key_id,
      purpose: 'effect_receipt',
      service_id: cell.seam_id,
      signEffectResult: expect.any(Function),
    });
    expect(Object.isFrozen(effectSigner)).toBe(true);
    expect(JSON.stringify(effectSigner)).not.toContain('effect.pem');
    expect(JSON.stringify(effectSigner)).not.toMatch(/PRIVATE KEY/);
  });

  it('rejects arbitrary seam drafts and cross-seam signing', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const cell = {
      ...fixtureCell(),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const authority = loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'authority.pem',
        keys.authority.privateKey,
      ),
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    const effectSigner = loadEffectReceiptSigner({
      secretFile: writePrivateKey(root, 'effect.pem', keys.effect.privateKey),
      keyId: keys.effect.record.key_id,
      serviceId: cell.seam_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    const grant = authority.issue(grantInput(cell));
    const observation = {
      observed_outcome: cell.expected.expected_outcome,
      effect_code: cell.expected.effect_code,
      before_hash: 'a'.repeat(64),
      after_hash: 'b'.repeat(64),
      forged_axis: cell.cell_id,
    };

    expect(() => effectSigner.signEffectResult({
      cell,
      grant,
      observation,
      predecessor: null,
    })).toThrowError(expect.objectContaining({
      code: 'effect_observation_invalid',
    }));
    expect(() => effectSigner.signEffectResult({
      cell: { ...cell, seam_id: 'kernel.other.seam' },
      grant,
      observation: {
        observed_outcome: cell.expected.expected_outcome,
        effect_code: cell.expected.effect_code,
        before_hash: 'a'.repeat(64),
        after_hash: 'b'.repeat(64),
      },
      predecessor: null,
    })).toThrowError(expect.objectContaining({
      code: 'effect_signer_boundary_invalid',
    }));
  });

  it('rechecks registry lifecycle at every signing operation', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const authority = loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'authority.pem',
        keys.authority.privateKey,
      ),
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });
    keys.authority.record.revoked_at =
      new Date(FIXTURE_NOW - 1).toISOString();

    expect(() => authority.issue(grantInput(fixtureCell())))
      .toThrowError(expect.objectContaining({
        code: 'signer_registry_key_inactive',
      }));
  });

  it('refuses caller attempts to raise the absolute private-key size ceiling', () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();

    expect(() => loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'authority.pem',
        keys.authority.privateKey,
      ),
      keyId: keys.authority.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      maximumBytes: 1_000_000,
    })).toThrowError(expect.objectContaining({
      code: 'signer_secret_size_invalid',
    }));
  });

  it('verifies collector material before signing and requires ancestry resolution', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const cell = {
      ...fixtureCell(),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const authority = loadExecutionGrantAuthority({
      secretFile: writePrivateKey(
        root,
        'authority.pem',
        keys.authority.privateKey,
      ),
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
    const secretFile = writePrivateKey(
      root,
      'collector.pem',
      keys.collector.privateKey,
    );
    const noResolver = loadCollectorSigner({
      secretFile,
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });

    await expect(noResolver({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [{ ...receipt, signature: 'invalid' }],
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
      previousBundleHash: null,
    })).rejects.toMatchObject({ code: 'effect_signature_invalid' });
    await expect(noResolver({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [receipt],
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
      previousBundleHash: 'c'.repeat(64),
    })).rejects.toMatchObject({ code: 'collector_previous_bundle_unavailable' });

    const previous = await noResolver({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [receipt],
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
      previousBundleHash: null,
    });
    const previousHash = sha256Canonical(previous);
    const collector = loadCollectorSigner({
      secretFile,
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      resolvePreviousBundle: (hash) => (
        hash === previousHash ? previous : null
      ),
    });
    await expect(collector({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [receipt],
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
      previousBundleHash: previousHash,
    })).resolves.toMatchObject({
      previous_bundle_hash: previousHash,
      signature: expect.any(String),
    });

    const durableCollector = loadCollectorSigner({
      secretFile,
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      resolvePreviousBundle: vi.fn(async (hash) => (
        hash === previousHash ? structuredClone(previous) : null
      )),
    });
    await expect(durableCollector({
      cell,
      grant,
      executionGrants: [grant],
      receipts: [receipt],
      cleanupEvidence: fixtureCleanupEvidence(cell, grant),
      previousBundleHash: previousHash,
    })).resolves.toMatchObject({
      previous_bundle_hash: previousHash,
      signature: expect.any(String),
    });
  });

  it('refuses recovery as a genesis bundle without a committed predecessor', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const violationCell = fixtureCell({ scenario: 'violation' });
    const recoveryCell = fixtureCell({ scenario: 'recovery' });
    const violationGrant = fixtureGrant(keys, violationCell);
    const recoveryGrant = fixtureGrant(keys, recoveryCell);
    const violationReceipt = fixtureReceipt(
      keys,
      violationGrant,
      violationCell,
    );
    const recoveryReceipt = fixtureReceipt(
      keys,
      recoveryGrant,
      recoveryCell,
      violationReceipt,
    );
    const collector = loadCollectorSigner({
      secretFile: writePrivateKey(
        root,
        'collector-recovery-genesis.pem',
        keys.collector.privateKey,
      ),
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
    });

    await expect(collector({
      cell: recoveryCell,
      grant: recoveryGrant,
      executionGrants: [violationGrant, recoveryGrant],
      receipts: [violationReceipt, recoveryReceipt],
      cleanupEvidence: fixtureCleanupEvidence(recoveryCell, recoveryGrant),
      previousBundleHash: null,
    })).rejects.toMatchObject({
      code: 'collector_recovery_predecessor_uncommitted',
    });
  });

  it('refuses a signed off-chain violation pair absent from committed ancestry', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const violationCell = fixtureCell({ scenario: 'violation' });
    const recoveryCell = fixtureCell({ scenario: 'recovery' });
    const committedGrant = fixtureGrant(keys, violationCell);
    const committedReceipt = fixtureReceipt(
      keys,
      committedGrant,
      violationCell,
    );
    const committedBundle = fixtureBundle(
      keys,
      violationCell,
      committedGrant,
      [committedReceipt],
    );
    const committedHash = sha256Canonical(committedBundle);
    const offChainGrant = fixtureGrant(keys, violationCell);
    const offChainReceipt = fixtureReceipt(
      keys,
      offChainGrant,
      violationCell,
    );
    const recoveryGrant = fixtureGrant(keys, recoveryCell);
    const recoveryReceipt = fixtureReceipt(
      keys,
      recoveryGrant,
      recoveryCell,
      offChainReceipt,
    );
    const collector = loadCollectorSigner({
      secretFile: writePrivateKey(
        root,
        'collector-off-chain.pem',
        keys.collector.privateKey,
      ),
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      resolvePreviousBundle: async (hash) => (
        hash === committedHash ? committedBundle : null
      ),
    });

    await expect(collector({
      cell: recoveryCell,
      grant: recoveryGrant,
      executionGrants: [offChainGrant, recoveryGrant],
      receipts: [offChainReceipt, recoveryReceipt],
      cleanupEvidence: fixtureCleanupEvidence(recoveryCell, recoveryGrant),
      previousBundleHash: committedHash,
    })).rejects.toMatchObject({
      code: 'collector_recovery_predecessor_uncommitted',
    });
  });

  it('refuses a committed predecessor with a different denial contract', async () => {
    const root = temporaryRoot();
    const keys = createTrustFixture();
    const violationCell = fixtureCell({ scenario: 'violation' });
    const recoveryCell = fixtureCell({ scenario: 'recovery' });
    const violationGrant = fixtureGrant(keys, violationCell);
    const differentDenial = fixtureReceipt(
      keys,
      violationGrant,
      violationCell,
      null,
      {
        observed_outcome: 'blocked',
        effect_code: 'different_denial',
      },
    );
    const violationBundle = fixtureBundle(
      keys,
      violationCell,
      violationGrant,
      [differentDenial],
    );
    const violationHash = sha256Canonical(violationBundle);
    const recoveryGrant = fixtureGrant(keys, recoveryCell);
    const recoveryReceipt = fixtureReceipt(
      keys,
      recoveryGrant,
      recoveryCell,
      differentDenial,
    );
    const collector = loadCollectorSigner({
      secretFile: writePrivateKey(
        root,
        'collector-different-denial.pem',
        keys.collector.privateKey,
      ),
      keyId: keys.collector.record.key_id,
      trustRegistry: keys.registry,
      now: () => FIXTURE_NOW,
      resolvePreviousBundle: async (hash) => (
        hash === violationHash ? violationBundle : null
      ),
    });

    await expect(collector({
      cell: recoveryCell,
      grant: recoveryGrant,
      executionGrants: [violationGrant, recoveryGrant],
      receipts: [differentDenial, recoveryReceipt],
      cleanupEvidence: fixtureCleanupEvidence(recoveryCell, recoveryGrant),
      previousBundleHash: violationHash,
    })).rejects.toMatchObject({
      code: 'collector_recovery_predecessor_contract_mismatch',
    });
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
