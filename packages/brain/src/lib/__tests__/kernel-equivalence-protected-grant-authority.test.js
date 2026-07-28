import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createProtectedGrantFileAuthority,
} from '../kernel-equivalence-protected-grant-authority.js';

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
  writeFileSync(grantPath, `${JSON.stringify({
    schema_version: 'kernel-equivalence-execution-grant/v1',
    grant_id: GRANT_ID,
    cell_id: CELL_ID,
    signature: 'protected-signature',
  })}\n`, { mode: 0o600 });
  chmodSync(grantPath, 0o600);
  return { parent, root, grantPath };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('protected execution grant file authority', () => {
  it('single-opens one opaque grant ref and returns an exact frozen grant', async () => {
    const value = fixture();
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).resolves.toEqual({
      cell_id: CELL_ID,
      grant_ref: GRANT_REF,
      grant: {
        schema_version: 'kernel-equivalence-execution-grant/v1',
        grant_id: GRANT_ID,
        cell_id: CELL_ID,
        signature: 'protected-signature',
      },
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
    expect(Object.isFrozen(resolved.grant)).toBe(true);
    expect(JSON.stringify(authority)).not.toContain('protected-signature');
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
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });

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
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_file_unsafe',
    });
  });

  it('rejects replacement of the protected root after startup', async () => {
    const value = fixture();
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });
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
      schema_version: 'kernel-equivalence-execution-grant/v1',
      grant_id: '11111111-1111-4111-8111-111111111111',
      cell_id: CELL_ID,
      signature: 'valid-but-different-grant',
    }],
    ['different cell', {
      schema_version: 'kernel-equivalence-execution-grant/v1',
      grant_id: GRANT_ID,
      cell_id: 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::normal',
      signature: 'valid-but-different-cell',
    }],
  ])('rejects a signed-looking grant bound to a %s', async (_label, grant) => {
    const value = fixture();
    writeFileSync(value.grantPath, JSON.stringify(grant), { mode: 0o600 });
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });

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
    const authority = createProtectedGrantFileAuthority({
      grantRoot: value.root,
    });

    await expect(authority.resolveProtectedGrant({
      cellId: CELL_ID,
      grantRef: GRANT_REF,
    })).rejects.toMatchObject({
      code: 'protected_grant_file_invalid',
    });
  });

  it.runIf(process.platform === 'darwin')(
    'rejects extended ACLs that grant access beyond mode bits',
    async () => {
      const value = fixture();
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow read',
        value.grantPath,
      ]);
      const authority = createProtectedGrantFileAuthority({
        grantRoot: value.root,
      });

      await expect(authority.resolveProtectedGrant({
        cellId: CELL_ID,
        grantRef: GRANT_REF,
      })).rejects.toMatchObject({
        code: 'protected_grant_file_unsafe',
      });
    },
  );

  it.runIf(process.platform === 'darwin')(
    'rejects an ACL-bearing protected root even when mode remains 0700',
    () => {
      const value = fixture();
      execFileSync('/bin/chmod', [
        '+a',
        'everyone allow list,search',
        value.root,
      ]);

      expect(() => createProtectedGrantFileAuthority({
        grantRoot: value.root,
      })).toThrowError(expect.objectContaining({
        code: 'protected_grant_root_unsafe',
      }));
    },
  );
});
