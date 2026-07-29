import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as protectedGrants
  from '../kernel-equivalence-protected-grant-authority.js';
import {
  loadExecutionGrantAuthority,
} from '../kernel-equivalence-signers.js';
import {
  sha256Canonical,
} from '../kernel-equivalence-receipts.js';
import {
  FIXTURE_ATTEMPT_ID,
  FIXTURE_NOW,
  FIXTURE_RUN_ID,
  FIXTURE_SHA,
  createTrustFixture,
  fixtureCell,
} from './kernel-equivalence-test-fixtures.js';

const roots = [];
const CASE_ID = '22222222-2222-4222-8222-222222222222';

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
  let pending;
  let published = false;
  const grantExecutionAuthority = Object.freeze({
    registerPendingGrant: vi.fn(async ({
      case_id: caseId,
      grant,
      grant_sha256: grantSha256,
    }) => {
      pending = {
        case_id: caseId,
        grant: structuredClone(grant),
        grant_sha256: grantSha256,
      };
      return {
        grant_id: grant.grant_id,
        grant_ref: `kernel-equivalence-grant:${grant.grant_id}`,
        grant_sha256: grantSha256,
        cell_id: grant.cell_id,
        expires_at: grant.expires_at,
      };
    }),
    markGrantPublished: vi.fn(async ({ grant_id: grantId }) => {
      published = true;
      return {
        grant_id: grantId,
        generation: 1,
        state: 'published',
        actor_instance_id: 'brain-test',
        actor_kind: 'brain',
        occurred_at: new Date(FIXTURE_NOW).toISOString(),
      };
    }),
    resolveActiveGrant: vi.fn(async ({
      grant_id: grantId,
      grant_sha256: grantSha256,
      cell_id: cellId,
    }) => {
      if (
        !published
        || pending?.grant.grant_id !== grantId
        || pending?.grant_sha256 !== grantSha256
        || pending?.grant.cell_id !== cellId
      ) {
        throw new Error('grant not active');
      }
      return {
        grant_id: grantId,
        grant_ref: `kernel-equivalence-grant:${grantId}`,
        grant_sha256: grantSha256,
        cell_id: cellId,
        expires_at: pending.grant.expires_at,
        grant: structuredClone(pending.grant),
        active: true,
      };
    }),
  });
  return {
    authority,
    cell,
    grantExecutionAuthority,
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
    case_id: CASE_ID,
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

function issuer(value, options = {}) {
  return protectedGrants.createProtectedGrantFileIssuer({
    grantRoot: value.grantRoot,
    executionGrantAuthority: value.authority,
    grantExecutionAuthority: value.grantExecutionAuthority,
    now: value.now,
    ...options,
  });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('protected execution grant issuer', () => {
  it('accepts millisecond-exact PostgreSQL Date registration expiry', async () => {
    const value = fixture();
    value.advance(123);
    value.grantExecutionAuthority.registerPendingGrant
      .mockImplementationOnce(async ({
        grant,
        grant_sha256: grantSha256,
      }) => ({
        grant_id: grant.grant_id,
        grant_ref: `kernel-equivalence-grant:${grant.grant_id}`,
        grant_sha256: grantSha256,
        cell_id: grant.cell_id,
        expires_at: new Date(grant.expires_at),
      }));

    await expect(issuer(value).issueProtectedGrant(
      grantInput(value.cell),
    )).resolves.toMatchObject({
      grant_id: value.grantId,
      expires_at: new Date(
        FIXTURE_NOW + 123 + 300_000,
      ).toISOString(),
    });
  });

  it('publishes one signed grant as a mode-0600 opaque reference readable by the separate reader', async () => {
    expect(
      typeof protectedGrants.createProtectedGrantFileIssuer,
    ).toBe('function');
    const value = fixture();
    const protectedIssuer = issuer(value);
    const issued = await protectedIssuer.issueProtectedGrant(
      grantInput(value.cell),
    );
    const grant = JSON.parse(readFileSync(
      join(value.grantRoot, `${value.grantId}.json`),
      'utf8',
    ));
    const grantSha256 = sha256Canonical(grant);

    expect(issued).toEqual({
      grant_ref: `kernel-equivalence-grant:${value.grantId}`,
      grant_id: value.grantId,
      grant_sha256: grantSha256,
      expires_at: new Date(FIXTURE_NOW + 300_000).toISOString(),
    });
    expect(Object.isFrozen(issued)).toBe(true);
    expect(Object.keys(grant)).toHaveLength(23);
    expect(value.grantExecutionAuthority.registerPendingGrant)
      .toHaveBeenCalledWith({
        case_id: CASE_ID,
        grant,
        grant_sha256: grantSha256,
      });
    expect(value.grantExecutionAuthority.markGrantPublished)
      .toHaveBeenCalledWith({
        grant_id: value.grantId,
        grant_sha256: grantSha256,
      });
    expect(
      value.grantExecutionAuthority.registerPendingGrant
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      value.grantExecutionAuthority.markGrantPublished
        .mock.invocationCallOrder[0],
    );
    expect(statSync(
      join(value.grantRoot, `${value.grantId}.json`),
    ).mode & 0o777).toBe(0o600);
    expect(protectedIssuer).toMatchObject({
      owner_service: 'brain.kernel_equivalence.grant_issuer',
      capability_id:
        'brain.kernel_equivalence.protected_grant_issuer.v1',
    });
    expect(JSON.stringify(protectedIssuer)).not.toMatch(
      /BEGIN PRIVATE KEY|grant-authority\.pem/,
    );

    const reader = protectedGrants.createProtectedGrantFileAuthority({
      grantRoot: value.grantRoot,
      grantExecutionAuthority: value.grantExecutionAuthority,
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
    expect(protectedIssuer.resolveProtectedGrant).toBeUndefined();
  });

  it('accepts pending registration expiry returned as a PostgreSQL Date', async () => {
    const value = fixture();
    value.grantExecutionAuthority.registerPendingGrant
      .mockImplementationOnce(async ({
        grant,
        grant_sha256: grantSha256,
      }) => ({
        grant_id: grant.grant_id,
        grant_ref: `kernel-equivalence-grant:${grant.grant_id}`,
        grant_sha256: grantSha256,
        cell_id: grant.cell_id,
        expires_at: new Date(grant.expires_at),
      }));

    await expect(issuer(value).issueProtectedGrant(
      grantInput(value.cell),
    )).resolves.toMatchObject({
      grant_id: value.grantId,
      expires_at: new Date(FIXTURE_NOW + 300_000).toISOString(),
    });
  });

  it('requires durable DB authority and a case_id before signing or touching transport', async () => {
    const value = fixture();
    expect(() => protectedGrants.createProtectedGrantFileIssuer({
      grantRoot: value.grantRoot,
      executionGrantAuthority: value.authority,
      now: value.now,
    })).toThrowError(expect.objectContaining({
      code: 'protected_grant_configuration_invalid',
    }));
    const input = grantInput(value.cell);
    delete input.case_id;

    await expect(issuer(value).issueProtectedGrant(input))
      .rejects.toMatchObject({
        code: 'protected_grant_case_id_invalid',
      });
    expect(value.grantExecutionAuthority.registerPendingGrant)
      .not.toHaveBeenCalled();
    expect(readdirSync(value.grantRoot)).toEqual([]);
  });

  it('orders registration, durable publish, mark, and post-mark final verification', async () => {
    const value = fixture();
    const actualFs = await vi.importActual('node:fs');
    const events = [];
    value.grantExecutionAuthority.registerPendingGrant
      .mockImplementationOnce(async ({ grant, grant_sha256: digest }) => {
        events.push('register');
        return {
          grant_id: grant.grant_id,
          grant_ref: `kernel-equivalence-grant:${grant.grant_id}`,
          grant_sha256: digest,
          cell_id: grant.cell_id,
          expires_at: grant.expires_at,
        };
      });
    value.grantExecutionAuthority.markGrantPublished
      .mockImplementationOnce(async ({ grant_id: grantId }) => {
        events.push('mark');
        return {
          grant_id: grantId,
          generation: 1,
          state: 'published',
          actor_instance_id: 'brain-test',
          actor_kind: 'brain',
          occurred_at: new Date(FIXTURE_NOW).toISOString(),
        };
      });
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      openSync: (...args) => {
        if (
          typeof args[0] === 'string'
          && args[0].endsWith('.tmp')
        ) {
          events.push('temp-open');
        }
        return actualFs.openSync(...args);
      },
      writeFileSync: (...args) => {
        if (typeof args[0] === 'number') events.push('temp-write');
        return actualFs.writeFileSync(...args);
      },
      fsyncSync: (descriptor) => {
        events.push(
          actualFs.fstatSync(descriptor).isDirectory()
            ? 'directory-fsync'
            : 'file-fsync',
        );
        return actualFs.fsyncSync(descriptor);
      },
      renameSync: (...args) => {
        events.push('rename');
        return actualFs.renameSync(...args);
      },
      readFileSync: (...args) => {
        if (typeof args[0] === 'number') events.push('final-verify');
        return actualFs.readFileSync(...args);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const protectedIssuer = isolated.createProtectedGrantFileIssuer({
        grantRoot: value.grantRoot,
        executionGrantAuthority: value.authority,
        grantExecutionAuthority: value.grantExecutionAuthority,
        now: value.now,
      });

      await protectedIssuer.issueProtectedGrant(grantInput(value.cell));

      expect(events).toEqual([
        'register',
        'temp-open',
        'temp-write',
        'file-fsync',
        'rename',
        'final-verify',
        'directory-fsync',
        'mark',
        'final-verify',
      ]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('does not create transport when pending DB registration fails', async () => {
    const value = fixture();
    value.grantExecutionAuthority.registerPendingGrant
      .mockRejectedValueOnce(new Error('fixture DB unavailable'));

    await expect(issuer(value).issueProtectedGrant(
      grantInput(value.cell),
    )).rejects.toMatchObject({
      code: 'protected_grant_registration_failed',
    });
    expect(value.grantExecutionAuthority.markGrantPublished)
      .not.toHaveBeenCalled();
    expect(readdirSync(value.grantRoot)).toEqual([]);
  });

  it('does not let descriptor-close failure skip temp cleanup or error mapping', async () => {
    const value = fixture();
    const actualFs = await vi.importActual('node:fs');
    let temporaryDescriptor;
    let closeFailed = false;
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      openSync: (...args) => {
        const descriptor = actualFs.openSync(...args);
        if (
          typeof args[0] === 'string'
          && args[0].endsWith('.tmp')
        ) {
          temporaryDescriptor = descriptor;
        }
        return descriptor;
      },
      writeFileSync: (target, ...args) => {
        if (target === temporaryDescriptor) {
          throw new Error('fixture temp write failure');
        }
        return actualFs.writeFileSync(target, ...args);
      },
      closeSync: (descriptor) => {
        if (descriptor === temporaryDescriptor && !closeFailed) {
          closeFailed = true;
          actualFs.closeSync(descriptor);
          throw new Error('fixture close failure');
        }
        return actualFs.closeSync(descriptor);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const protectedIssuer = isolated.createProtectedGrantFileIssuer({
        grantRoot: value.grantRoot,
        executionGrantAuthority: value.authority,
        grantExecutionAuthority: value.grantExecutionAuthority,
        now: value.now,
      });

      await expect(protectedIssuer.issueProtectedGrant(
        grantInput(value.cell),
      )).rejects.toMatchObject({
        code: 'protected_grant_publish_failed',
      });
      expect(readdirSync(value.grantRoot)).toEqual([]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('attaches safe identity when mark commit outcome is uncertain and retains the orphan', async () => {
    const value = fixture();
    value.grantExecutionAuthority.markGrantPublished
      .mockRejectedValueOnce(Object.assign(
        new Error('fixture COMMIT acknowledgement lost'),
        { code: 'grant_transaction_outcome_unknown' },
      ));

    let publicationError;
    try {
      await issuer(value).issueProtectedGrant(grantInput(value.cell));
    } catch (error) {
      publicationError = error;
    }

    expect(publicationError).toMatchObject({
      code: 'protected_grant_publication_uncertain',
      grant_identity: {
        grant_id: value.grantId,
        grant_ref: `kernel-equivalence-grant:${value.grantId}`,
        grant_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        expires_at: new Date(FIXTURE_NOW + 300_000).toISOString(),
      },
    });
    expect(Object.keys(publicationError.grant_identity).sort()).toEqual([
      'expires_at',
      'grant_id',
      'grant_ref',
      'grant_sha256',
    ]);
    expect(Object.isFrozen(publicationError.grant_identity)).toBe(true);
    expect(JSON.stringify(publicationError.grant_identity)).not.toMatch(
      /signature|payload|private|secret/i,
    );
    expect(readdirSync(value.grantRoot)).toEqual([
      `${value.grantId}.json`,
    ]);
  });

  it.each([
    ['replacement', (grantPath) => {
      const displaced = `${grantPath}.displaced`;
      const bytes = readFileSync(grantPath);
      renameSync(grantPath, displaced);
      writeFileSync(grantPath, bytes, { mode: 0o600 });
    }],
    ['deletion', (grantPath) => {
      rmSync(grantPath);
    }],
  ])('reports publication uncertain when mark succeeds after final %s', async (
    _label,
    mutate,
  ) => {
    const value = fixture();
    let releaseMark;
    let markStarted;
    const started = new Promise((resolve) => {
      markStarted = resolve;
    });
    const barrier = new Promise((resolve) => {
      releaseMark = resolve;
    });
    value.grantExecutionAuthority.markGrantPublished
      .mockImplementationOnce(async ({ grant_id: grantId }) => {
        markStarted();
        await barrier;
        return {
          grant_id: grantId,
          generation: 1,
          state: 'published',
          actor_instance_id: 'brain-test',
          actor_kind: 'brain',
          occurred_at: new Date(FIXTURE_NOW).toISOString(),
        };
      });
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    const issuance = issuer(value).issueProtectedGrant(
      grantInput(value.cell),
    );
    const assertion = expect(issuance).rejects.toMatchObject({
      code: 'protected_grant_publication_uncertain',
    });
    await started;
    mutate(grantPath);
    releaseMark();

    await assertion;
  });

  it('preserves a replacement inode while reporting DB publication uncertain', async () => {
    const value = fixture();
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    const displaced = join(value.grantRoot, 'displaced-original');
    value.grantExecutionAuthority.markGrantPublished
      .mockImplementationOnce(async () => {
        renameSync(grantPath, displaced);
        writeFileSync(grantPath, 'replacement\n', { mode: 0o600 });
        throw new Error('fixture DB unavailable');
      });

    await expect(issuer(value).issueProtectedGrant(
      grantInput(value.cell),
    )).rejects.toMatchObject({
      code: 'protected_grant_publication_uncertain',
    });
    expect(readFileSync(grantPath, 'utf8')).toBe('replacement\n');
  });

  it('rejects an expired grant while conservative cleanup retains its transport', async () => {
    const value = fixture();
    const protectedIssuer = issuer(value);
    const issued = await protectedIssuer.issueProtectedGrant(
      grantInput(value.cell, 1),
    );
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    value.advance(1_001);
    const reader = protectedGrants.createProtectedGrantFileAuthority({
      grantRoot: value.grantRoot,
      grantExecutionAuthority: value.grantExecutionAuthority,
      now: value.now,
    });

    await expect(reader.resolveProtectedGrant({
      cellId: value.cell.cell_id,
      grantRef: issued.grant_ref,
    })).rejects.toMatchObject({
      code: 'protected_grant_expired',
    });
    expect(typeof protectedIssuer.cleanupExpiredGrants).toBe('function');
    await expect(protectedIssuer.cleanupExpiredGrants()).resolves.toEqual({
      removed: 0,
      retained: 1,
    });
    expect(existsSync(grantPath)).toBe(true);
    expect(reader.cleanupExpiredGrants).toBeUndefined();
  });

  it('conservatively retains transport without claiming DB revocation safety', async () => {
    const value = fixture();
    const protectedIssuer = issuer(value);
    const issued = await protectedIssuer.issueProtectedGrant(
      grantInput(value.cell),
    );
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );

    await expect(protectedIssuer.revokeProtectedGrant({
      grant_ref: issued.grant_ref,
    })).resolves.toEqual({
      grant_ref: issued.grant_ref,
      transport_removed: false,
    });
    expect(existsSync(grantPath)).toBe(true);
    const reader = protectedGrants.createProtectedGrantFileAuthority({
      grantRoot: value.grantRoot,
      grantExecutionAuthority: value.grantExecutionAuthority,
      now: value.now,
    });
    value.grantExecutionAuthority.resolveActiveGrant
      .mockRejectedValueOnce(new Error('durably revoked'));
    await expect(reader.resolveProtectedGrant({
      cellId: value.cell.cell_id,
      grantRef: issued.grant_ref,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_denied',
    });
  });

  it('retains an unpublished orphan when directory fsync fails after rename', async () => {
    const value = fixture();
    const actualFs = await vi.importActual('node:fs');
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      fsyncSync: (descriptor) => {
        if (actualFs.fstatSync(descriptor).isDirectory()) {
          throw new Error('fixture directory fsync failure');
        }
        return actualFs.fsyncSync(descriptor);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const issuer = isolated.createProtectedGrantFileIssuer({
        grantRoot: value.grantRoot,
        executionGrantAuthority: value.authority,
        grantExecutionAuthority: value.grantExecutionAuthority,
        now: value.now,
      });

      await expect(issuer.issueProtectedGrant(
        grantInput(value.cell),
      )).rejects.toMatchObject({
        code: 'protected_grant_publish_failed',
      });
      expect(value.grantExecutionAuthority.registerPendingGrant)
        .toHaveBeenCalledOnce();
      expect(value.grantExecutionAuthority.markGrantPublished)
        .not.toHaveBeenCalled();
      expect(readdirSync(value.grantRoot)).toEqual([
        `${value.grantId}.json`,
      ]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('never overwrites a published grant and removes its temporary file on collision', async () => {
    const value = fixture();
    const protectedIssuer = issuer(value);
    await protectedIssuer.issueProtectedGrant(grantInput(value.cell));
    const grantPath = join(
      value.grantRoot,
      `${value.grantId}.json`,
    );
    const original = readFileSync(grantPath);

    await expect(protectedIssuer.issueProtectedGrant(
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
    const protectedIssuer = issuer(value);
    await protectedIssuer.issueProtectedGrant(grantInput(value.cell));
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

    await expect(protectedIssuer.cleanupExpiredGrants()).resolves.toEqual({
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

  it('enforces the production-configured grant TTL below the registry maximum', async () => {
    const value = fixture();
    const protectedIssuer = issuer(value, {
      maximumTtlSeconds: 300,
    });

    await expect(protectedIssuer.issueProtectedGrant(
      grantInput(value.cell, 600),
    )).rejects.toMatchObject({
      code: 'protected_grant_ttl_exceeded',
    });
    expect(readdirSync(value.grantRoot)).toEqual([]);
  });

  it('retains an expired file whose signed grant id does not match its filename', async () => {
    const value = fixture();
    const protectedIssuer = issuer(value);
    await protectedIssuer.issueProtectedGrant(grantInput(value.cell, 1));
    const mismatchedId =
      '99999999-9999-4999-8999-999999999999';
    renameSync(
      join(value.grantRoot, `${value.grantId}.json`),
      join(value.grantRoot, `${mismatchedId}.json`),
    );
    value.advance(1_001);

    await expect(protectedIssuer.cleanupExpiredGrants()).resolves.toEqual({
      removed: 0,
      retained: 1,
    });
    expect(existsSync(
      join(value.grantRoot, `${mismatchedId}.json`),
    )).toBe(true);
  });
});
