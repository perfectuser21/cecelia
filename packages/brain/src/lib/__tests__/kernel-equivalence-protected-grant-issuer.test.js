import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as protectedGrants
  from '../kernel-equivalence-protected-grant-authority.js';
import {
  loadExecutionGrantAuthority,
} from '../kernel-equivalence-signers.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  FIXTURE_SHA,
  createTrustFixture,
  fixtureCell,
} from './kernel-equivalence-test-fixtures.js';

const roots = [];

function fixture() {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), 'kernel-eq-grant-control-')),
  );
  roots.push(parent);
  const grantRoot = join(parent, 'protected');
  mkdirSync(grantRoot, { mode: 0o700 });
  chmodSync(grantRoot, 0o700);
  const keys = createTrustFixture();
  const secretFile = join(parent, 'grant-authority.pem');
  writeFileSync(
    secretFile,
    keys.authority.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }),
    { mode: 0o600 },
  );
  chmodSync(secretFile, 0o600);
  let sequence = 0;
  let currentTime = FIXTURE_NOW;
  const ids = [
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555',
  ];
  const authority = loadExecutionGrantAuthority({
    secretFile,
    keyId: keys.authority.record.key_id,
    trustRegistry: keys.registry,
    now: () => currentTime,
    randomUUID: () => ids[sequence++],
  });
  const cell = {
    ...fixtureCell({
      behaviorId: 'KERNEL-P0-04-CI-MERGE-AUTHORITY',
    }),
    effect_signer_status: 'available',
    effect_key_id: keys.effect.record.key_id,
    blocked_by: null,
  };
  return {
    authority,
    cell,
    grantRoot,
    grantId: ids[0],
    now: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

function grantInput(cell, ttlSeconds = 300) {
  return {
    cell,
    run_id: FIXTURE_RUN_ID,
    attempt_id: FIXTURE_ATTEMPT_ID,
    artifact_sha: FIXTURE_SHA,
    brain_version: '1.268.19',
    engine_version: '19.7.1',
    resource_id: `eq-${FIXTURE_ATTEMPT_ID}`,
    resource_ref:
      `refs/heads/equivalence-drill/${FIXTURE_RUN_ID}/${FIXTURE_ATTEMPT_ID}/case`,
    ttl_seconds: ttlSeconds,
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('protected execution grant issuer', () => {
  it('publishes one signed grant as a mode-0600 opaque reference readable by the separate reader', async () => {
    expect(
      typeof protectedGrants.createProtectedGrantFileIssuer,
    ).toBe('function');
    const value = fixture();
    const issuer = protectedGrants.createProtectedGrantFileIssuer({
      grantRoot: value.grantRoot,
      executionGrantAuthority: value.authority,
      now: value.now,
    });
    const issued = await issuer.issueProtectedGrant(
      grantInput(value.cell),
    );

    expect(issued).toEqual({
      grant_ref: `kernel-equivalence-grant:${value.grantId}`,
      expires_at: new Date(FIXTURE_NOW + 300_000).toISOString(),
    });
    expect(statSync(
      join(value.grantRoot, `${value.grantId}.json`),
    ).mode & 0o777).toBe(0o600);
    expect(issuer).toMatchObject({
      owner_service: 'brain.kernel_equivalence.grant_issuer',
      capability_id:
        'brain.kernel_equivalence.protected_grant_issuer.v1',
    });
    expect(JSON.stringify(issuer)).not.toMatch(
      /BEGIN PRIVATE KEY|grant-authority\.pem/,
    );

    const reader = protectedGrants.createProtectedGrantFileAuthority({
      grantRoot: value.grantRoot,
      now: value.now,
    });
    await expect(reader.resolveProtectedGrant({
      cellId: value.cell.cell_id,
      grantRef: issued.grant_ref,
    })).resolves.toMatchObject({
      cell_id: value.cell.cell_id,
      grant_ref: issued.grant_ref,
      grant: {
        grant_id: value.grantId,
        cell_id: value.cell.cell_id,
      },
    });
    expect(reader.issueProtectedGrant).toBeUndefined();
    expect(issuer.resolveProtectedGrant).toBeUndefined();
  });

  it('rejects an expired grant and lets only the issuer remove its exact file', async () => {
    const value = fixture();
    const issuer = protectedGrants.createProtectedGrantFileIssuer({
      grantRoot: value.grantRoot,
      executionGrantAuthority: value.authority,
      now: value.now,
    });
    const issued = await issuer.issueProtectedGrant(
      grantInput(value.cell, 1),
    );
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    value.advance(1_001);
    const reader = protectedGrants.createProtectedGrantFileAuthority({
      grantRoot: value.grantRoot,
      now: value.now,
    });

    await expect(reader.resolveProtectedGrant({
      cellId: value.cell.cell_id,
      grantRef: issued.grant_ref,
    })).rejects.toMatchObject({
      code: 'protected_grant_expired',
    });
    expect(typeof issuer.cleanupExpiredGrants).toBe('function');
    await expect(issuer.cleanupExpiredGrants()).resolves.toEqual({
      removed: 1,
      retained: 0,
    });
    expect(existsSync(grantPath)).toBe(false);
    expect(reader.cleanupExpiredGrants).toBeUndefined();
  });

  it('never overwrites a published grant and removes its temporary file on collision', async () => {
    const value = fixture();
    const issuer = protectedGrants.createProtectedGrantFileIssuer({
      grantRoot: value.grantRoot,
      executionGrantAuthority: value.authority,
      now: value.now,
    });
    await issuer.issueProtectedGrant(grantInput(value.cell));
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    const original = readFileSync(grantPath);

    await expect(issuer.issueProtectedGrant(
      grantInput(value.cell),
    )).rejects.toMatchObject({
      code: 'protected_grant_already_exists',
    });
    expect(readFileSync(grantPath)).toEqual(original);
    expect(readdirSync(value.grantRoot)).toEqual([
      `${value.grantId}.json`,
    ]);
  });

  it('retains unexpired, symlinked, hard-linked, and malformed candidates', async () => {
    const value = fixture();
    const issuer = protectedGrants.createProtectedGrantFileIssuer({
      grantRoot: value.grantRoot,
      executionGrantAuthority: value.authority,
      now: value.now,
    });
    await issuer.issueProtectedGrant(grantInput(value.cell));
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    const hardLinkId =
      '66666666-6666-4666-8666-666666666666';
    linkSync(
      grantPath,
      join(value.grantRoot, `${hardLinkId}.json`),
    );
    const outside = join(value.grantRoot, 'outside');
    writeFileSync(outside, '{"expires_at":"2020-01-01T00:00:00Z"}', {
      mode: 0o600,
    });
    const symlinkId =
      '77777777-7777-4777-8777-777777777777';
    symlinkSync(
      outside,
      join(value.grantRoot, `${symlinkId}.json`),
    );
    const malformedId =
      '88888888-8888-4888-8888-888888888888';
    writeFileSync(
      join(value.grantRoot, `${malformedId}.json`),
      '{"expires_at":',
      { mode: 0o600 },
    );

    await expect(issuer.cleanupExpiredGrants()).resolves.toEqual({
      removed: 0,
      retained: 4,
    });
    expect(existsSync(grantPath)).toBe(true);
    expect(existsSync(
      join(value.grantRoot, `${hardLinkId}.json`),
    )).toBe(true);
    expect(existsSync(
      join(value.grantRoot, `${symlinkId}.json`),
    )).toBe(true);
    expect(existsSync(
      join(value.grantRoot, `${malformedId}.json`),
    )).toBe(true);
  });
});
