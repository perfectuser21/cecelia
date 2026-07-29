import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  createProtectedGrantFileAuthority,
} from '../kernel-equivalence-protected-grant-authority.js';
import {
  sha256Canonical,
} from '../kernel-equivalence-receipts.js';

const CELL_ID =
  'KERNEL-P0-01-BRANCH-PROTECTION::codex::normal';
const GRANT_ID = 'abcdef11-abcd-4abc-8abc-abcdefabcdef';
const GRANT_REF = `kernel-equivalence-grant:${GRANT_ID}`;
const roots = [];

function fixture() {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), 'kernel-eq-grants-')),
  );
  roots.push(parent);
  const root = join(parent, 'protected');
  mkdirSync(root, { mode: 0o700 });
  chmodSync(root, 0o700);
  const grantPath = join(root, `${GRANT_ID}.json`);
  const grant = {
    schema_version: 'kernel-equivalence-execution-grant/v1',
    grant_id: GRANT_ID,
    key_id: 'fixture-grant-key',
    issued_at: '2026-07-28T12:00:00.000Z',
    cell_id: CELL_ID,
    expires_at: '2999-01-01T00:00:00.123Z',
    nonce: '11111111-1111-4111-8111-111111111111',
    behavior_id: 'KERNEL-P0-01-BRANCH-PROTECTION',
    provider: 'codex',
    scenario: 'normal',
    run_id: '22222222-2222-4222-8222-222222222222',
    attempt_id: '33333333-3333-4333-8333-333333333333',
    artifact_sha: 'a'.repeat(64),
    brain_version: '1.268.30',
    engine_version: '19.7.1',
    environment: 'isolated',
    resource_id: 'fixture-resource',
    resource_ref: 'refs/heads/fixture',
    resource_prefix: 'fixture-prefix',
    seam_id: 'kernel.security.branch_protection',
    adapter_id: 'branch-protection-adapter',
    scopes: ['isolated_effect'],
    signature: 'protected-signature',
  };
  writeFileSync(grantPath, `${JSON.stringify(grant)}\n`, { mode: 0o600 });
  chmodSync(grantPath, 0o600);
  const grantSha256 = sha256Canonical(grant);
  let durableState = 'active';
  const grantExecutionAuthority = Object.freeze({
    registerPendingGrant: vi.fn(),
    markGrantPublished: vi.fn(),
    resolveActiveGrant: vi.fn(async ({
      grant_id: grantId,
      grant_sha256: digest,
      cell_id: cellId,
    }) => {
      if (durableState !== 'active') {
        throw new Error(`grant ${durableState}`);
      }
      return {
        grant_id: grantId,
        grant_ref: GRANT_REF,
        grant_sha256: digest,
        cell_id: cellId,
        expires_at: grant.expires_at,
        grant: structuredClone(grant),
        active: true,
      };
    }),
  });
  return {
    parent,
    root,
    grantPath,
    grant,
    grantSha256,
    grantExecutionAuthority,
    setDurableState: (state) => {
      durableState = state;
    },
  };
}

function reader(value, options = {}) {
  return createProtectedGrantFileAuthority({
    grantRoot: value.root,
    grantExecutionAuthority: value.grantExecutionAuthority,
    ...options,
  });
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('protected execution grant file authority', () => {
  it('requires the server-owned durable grant authority', () => {
    const value = fixture();

    expect(() => createProtectedGrantFileAuthority({
      grantRoot: value.root,
    })).toThrowError(expect.objectContaining({
      code: 'protected_grant_configuration_invalid',
    }));
  });

  it.each([0, 300_001, 1.5])(
    'rejects unsafe authority timeout %s',
    (authorityTimeoutMs) => {
      const value = fixture();

      expect(() => createProtectedGrantFileAuthority({
        grantRoot: value.root,
        grantExecutionAuthority: value.grantExecutionAuthority,
        authorityTimeoutMs,
      })).toThrowError(expect.objectContaining({
        code: 'protected_grant_configuration_invalid',
      }));
    },
  );

  it('exports the Node-canonical grant digest', () => {
    const value = fixture();

    expect(Object.keys(value.grant)).toHaveLength(23);
    expect(typeof protectedGrants.canonicalGrantSha256).toBe('function');
    expect(protectedGrants.canonicalGrantSha256(value.grant))
      .toBe(sha256Canonical(value.grant));
  });

  it.each([
    ['a missing signed field', (grant) => {
      delete grant.adapter_id;
    }],
    ['an extra signed field', (grant) => {
      grant.case_id = '44444444-4444-4444-8444-444444444444';
    }],
  ])('rejects canonical digest input with %s', (_label, mutate) => {
    const value = fixture();
    const grant = structuredClone(value.grant);
    mutate(grant);

    expect(() => protectedGrants.canonicalGrantSha256(grant))
      .toThrowError(expect.objectContaining({
        code: 'protected_grant_invalid',
      }));
  });

  it('single-opens transport, resolves DB authority, and returns an exact frozen grant plus digest', async () => {
    const value = fixture();
    const authority = reader(value);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).resolves.toEqual({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
      grant_sha256: value.grantSha256,
      grant: value.grant,
    });
    expect(value.grantExecutionAuthority.resolveActiveGrant)
      .toHaveBeenCalledWith({
        grant_id: GRANT_ID,
        grant_sha256: value.grantSha256,
        cell_id: CELL_ID,
      });
    expect(authority).toMatchObject({
      owner_service: 'brain.kernel_equivalence.grants',
      capability_id:
        'brain.kernel_equivalence.protected_grant_reader.v1',
    });
    const resolved = await authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.grant)).toBe(true);
    expect(JSON.stringify(authority)).not.toContain('protected-signature');
  });

  it('accepts the same durable expiry returned as a PostgreSQL Date', async () => {
    const value = fixture();
    value.grantExecutionAuthority.resolveActiveGrant
      .mockResolvedValueOnce({
        grant_id: GRANT_ID,
        grant_ref: GRANT_REF,
        grant_sha256: value.grantSha256,
        cell_id: CELL_ID,
        expires_at: new Date(value.grant.expires_at),
        grant: structuredClone(value.grant),
        active: true,
      });

    await expect(reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).resolves.toMatchObject({
      grant_sha256: value.grantSha256,
      grant: value.grant,
    });
  });

  it('times out a pending durable resolution and promptly closes its grant fd', async () => {
    const value = fixture();
    const actualFs = await vi.importActual('node:fs');
    let grantDescriptor;
    const closed = [];
    value.grantExecutionAuthority.resolveActiveGrant
      .mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve({
          grant_id: GRANT_ID,
          grant_ref: GRANT_REF,
          grant_sha256: value.grantSha256,
          cell_id: CELL_ID,
          expires_at: value.grant.expires_at,
          grant: structuredClone(value.grant),
          active: true,
        }), 50);
      }));
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      openSync: (...args) => {
        const descriptor = actualFs.openSync(...args);
        if (args[0] === value.grantPath) grantDescriptor = descriptor;
        return descriptor;
      },
      closeSync: (descriptor) => {
        closed.push(descriptor);
        return actualFs.closeSync(descriptor);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const authority = isolated.createProtectedGrantFileAuthority({
        grantRoot: value.root,
        grantExecutionAuthority: value.grantExecutionAuthority,
        authorityTimeoutMs: 5,
      });

      await expect(authority.resolveProtectedGrant({
        cellId: CELL_ID,
        grantRef: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'protected_grant_authority_denied',
      });
      expect(closed).toContain(grantDescriptor);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('rejects an unpublished transport from durable pending state', async () => {
    const value = fixture();
    value.setDurableState('pending');

    await expect(reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_denied',
    });
    expect(value.grantExecutionAuthority.resolveActiveGrant)
      .toHaveBeenCalledWith({
        grant_id: GRANT_ID,
        grant_sha256: value.grantSha256,
        cell_id: CELL_ID,
      });
  });

  it.each([
    ['restored', (value) => {
      rmSync(value.grantPath);
      writeFileSync(
        value.grantPath,
        `${JSON.stringify(value.grant)}\n`,
        { mode: 0o600 },
      );
    }],
    ['replaced', (value) => {
      const replacement = `${value.grantPath}.replacement`;
      writeFileSync(
        replacement,
        `${JSON.stringify(value.grant)}\n`,
        { mode: 0o600 },
      );
      renameSync(replacement, value.grantPath);
    }],
  ])('rejects a %s transport after durable revocation', async (
    _label,
    mutate,
  ) => {
    const value = fixture();
    await reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    });
    value.setDurableState('revoked');
    mutate(value);

    await expect(reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_denied',
    });
    expect(value.grantExecutionAuthority.resolveActiveGrant)
      .toHaveBeenLastCalledWith({
        grant_id: GRANT_ID,
        grant_sha256: value.grantSha256,
        cell_id: CELL_ID,
      });
  });

  it('rejects a path replaced after the opened inode was fully read', async () => {
    const value = fixture();
    const actualChild = await vi.importActual('node:child_process');
    let grantPathInspections = 0;
    vi.resetModules();
    vi.doMock('node:child_process', () => ({
      ...actualChild,
      execFileSync: (...args) => {
        const inspectedPath = args[1]?.at(-1);
        if (inspectedPath === value.grantPath) {
          grantPathInspections += 1;
          if (grantPathInspections === 2) {
            const replacement = `${value.grantPath}.replacement`;
            writeFileSync(
              replacement,
              `${JSON.stringify(value.grant)}\n`,
              { mode: 0o600 },
            );
            renameSync(replacement, value.grantPath);
          }
        }
        return actualChild.execFileSync(...args);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const authority = isolated.createProtectedGrantFileAuthority({
        grantRoot: value.root,
        grantExecutionAuthority: value.grantExecutionAuthority,
      });

      await expect(authority.resolveProtectedGrant({
        cellId: CELL_ID,
        grantRef: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'protected_grant_file_unsafe',
      });
      expect(value.grantExecutionAuthority.resolveActiveGrant)
        .not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:child_process');
      vi.resetModules();
    }
  });

  it.each([
    ['digest', { grant_sha256: '0'.repeat(64) }],
    ['grant id', {
      grant_id: '11111111-1111-4111-8111-111111111111',
    }],
    ['cell id', {
      cell_id: 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::normal',
    }],
    ['expiry', { expires_at: '2998-01-01T00:00:00.000Z' }],
    ['payload', { grant: null }],
    ['active state', { active: false }],
  ])('rejects DB %s mismatch with the transport payload', async (
    _label,
    override,
  ) => {
    const value = fixture();
    const durable = {
      grant_id: GRANT_ID,
      grant_ref: GRANT_REF,
      grant_sha256: value.grantSha256,
      cell_id: CELL_ID,
      expires_at: value.grant.expires_at,
      grant: structuredClone(value.grant),
      active: true,
      ...override,
    };
    if (_label === 'payload') {
      durable.grant = {
        ...value.grant,
        signature: 'different-signed-payload',
      };
    }
    value.grantExecutionAuthority.resolveActiveGrant
      .mockResolvedValueOnce(durable);

    await expect(reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_authority_mismatch',
    });
  });

  it.each([
    ['caller path', '../grant.json'],
    ['absolute path', '/tmp/grant.json'],
    ['wrong namespace', `caller-grant:${GRANT_ID}`],
    ['uppercase UUID', `kernel-equivalence-grant:${GRANT_ID.toUpperCase()}`],
    ['extra field', GRANT_REF, { grantPath: '/tmp/injected' }],
  ])('rejects %s before filesystem resolution', async (
    _label,
    grantRef,
    extra = {},
  ) => {
    const value = fixture();
    const authority = reader(value);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef,
      ...extra,
    })).rejects.toMatchObject({
      code: 'protected_grant_request_invalid',
    });
  });

  it.each([
    ['world-readable root', ({ root }) => chmodSync(root, 0o755)],
    ['symlink root', ({ parent, root }) => {
      rmSync(root, { recursive: true, force: true });
      const target = join(parent, 'target');
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, root);
    }],
    ['symlink parent', ({ parent, root }) => {
      const actualParent = join(parent, 'actual');
      mkdirSync(actualParent, { mode: 0o700 });
      const movedRoot = join(actualParent, 'protected');
      mkdirSync(movedRoot, { mode: 0o700 });
      rmSync(root, { recursive: true, force: true });
      const alias = join(parent, 'alias');
      symlinkSync(actualParent, alias);
      return join(alias, 'protected');
    }],
  ])('fails startup for %s', (_label, mutate) => {
    const value = fixture();
    const mutatedRoot = mutate(value) ?? value.root;

    expect(() => createProtectedGrantFileAuthority({
      grantRoot: mutatedRoot,
      grantExecutionAuthority: value.grantExecutionAuthority,
    })).toThrowError(expect.objectContaining({
      code: 'protected_grant_root_unsafe',
    }));
  });

  it.each([
    ['world-readable file', ({ grantPath }) => chmodSync(grantPath, 0o644)],
    ['symlink file', ({ parent, grantPath }) => {
      rmSync(grantPath);
      const target = join(parent, 'outside.json');
      writeFileSync(target, '{}\n', { mode: 0o600 });
      symlinkSync(target, grantPath);
    }],
    ['hard-linked file', ({ parent, grantPath }) => {
      linkSync(grantPath, join(parent, 'second-link.json'));
    }],
    ['oversized file', ({ grantPath }) => {
      writeFileSync(grantPath, 'x'.repeat(65_537), { mode: 0o600 });
    }],
  ])('rejects %s', async (_label, mutate) => {
    const value = fixture();
    mutate(value);
    const authority = reader(value);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_file_unsafe',
    });
  });

  it('rejects replacement of the protected root after startup', async () => {
    const value = fixture();
    const authority = reader(value);
    rmSync(value.root, { recursive: true, force: true });
    const replacement = join(value.parent, 'replacement');
    mkdirSync(replacement, { mode: 0o700 });
    const replacementGrant = join(replacement, `${GRANT_ID}.json`);
    writeFileSync(replacementGrant, '{"attacker":true}\n', { mode: 0o600 });
    symlinkSync(replacement, value.root);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_root_unsafe',
    });
  });

  it.each([
    ['different grant id', {
      grant_id: '11111111-1111-4111-8111-111111111111',
      signature: 'valid-but-different-grant',
    }],
    ['different cell', {
      cell_id: 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::normal',
      signature: 'valid-but-different-cell',
    }],
  ])('rejects a signed-looking grant bound to a %s', async (
    _label,
    override,
  ) => {
    const value = fixture();
    const grant = {
      ...value.grant,
      ...override,
    };
    writeFileSync(value.grantPath, JSON.stringify(grant), { mode: 0o600 });
    const authority = reader(value);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_binding_invalid',
    });
  });

  it('rejects malformed grant JSON without leaking parser details', async () => {
    const value = fixture();
    writeFileSync(value.grantPath, '{"grant_id":', { mode: 0o600 });
    const authority = reader(value);

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_file_invalid',
    });
  });

  it.each([
    ['missing field', (grant) => {
      delete grant.adapter_id;
    }],
    ['extra field', (grant) => {
      grant.case_id = '44444444-4444-4444-8444-444444444444';
    }],
  ])('rejects a transport grant with an exact-schema %s', async (
    _label,
    mutate,
  ) => {
    const value = fixture();
    const grant = structuredClone(value.grant);
    mutate(grant);
    writeFileSync(
      value.grantPath,
      `${JSON.stringify(grant)}\n`,
      { mode: 0o600 },
    );

    await expect(reader(value).resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_file_invalid',
    });
    expect(value.grantExecutionAuthority.resolveActiveGrant)
      .not.toHaveBeenCalled();
  });

  it('closes the opened inode when canonical digest validation fails', async () => {
    const value = fixture();
    const canonicalInvalid = JSON.stringify({
      ...value.grant,
      brain_version: 'OVERFLOW',
    }).replace('"brain_version":"OVERFLOW"', '"brain_version":1e400');
    writeFileSync(
      value.grantPath,
      `${canonicalInvalid}\n`,
      { mode: 0o600 },
    );
    const actualFs = await vi.importActual('node:fs');
    let grantDescriptor;
    const closed = [];
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...actualFs,
      openSync: (...args) => {
        const descriptor = actualFs.openSync(...args);
        if (args[0] === value.grantPath) grantDescriptor = descriptor;
        return descriptor;
      },
      closeSync: (descriptor) => {
        closed.push(descriptor);
        return actualFs.closeSync(descriptor);
      },
    }));
    try {
      const isolated = await import(
        '../kernel-equivalence-protected-grant-authority.js'
      );
      const authority = isolated.createProtectedGrantFileAuthority({
        grantRoot: value.root,
        grantExecutionAuthority: value.grantExecutionAuthority,
      });

      await expect(authority.resolveProtectedGrant({
        cellId: CELL_ID,
        grantRef: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'protected_grant_file_invalid',
      });
      expect(closed).toContain(grantDescriptor);
      expect(value.grantExecutionAuthority.resolveActiveGrant)
        .not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it.runIf(process.platform === 'darwin')(
    'rejects grant files bearing both an xattr and extended ACL',
    async () => {
      const value = fixture();
      execFileSync('/usr/bin/xattr', [
        '-w',
        'com.cecelia.kernel-equivalence-test',
        'present',
        value.grantPath,
      ]);
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow read',
        value.grantPath,
      ]);
      const authority = reader(value);

      await expect(authority.resolveProtectedGrant({
        cellId: CELL_ID,
        grantRef: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'protected_grant_file_unsafe',
      });
    },
  );

  it.runIf(process.platform === 'darwin')(
    'rejects a protected root bearing both an xattr and ACL',
    () => {
      const value = fixture();
      execFileSync('/usr/bin/xattr', [
        '-w',
        'com.cecelia.kernel-equivalence-test',
        'present',
        value.root,
      ]);
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow list,search',
        value.root,
      ]);

      expect(() => createProtectedGrantFileAuthority({
        grantRoot: value.root,
        grantExecutionAuthority: value.grantExecutionAuthority,
      })).toThrowError(expect.objectContaining({
        code: 'protected_grant_root_unsafe',
      }));
    },
  );
});
