import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestTree } from '../../../../../scripts/lib/release-run-tree-digest.mjs';

const script = resolve(
  import.meta.dirname,
  '../../../../../scripts/promote-dashboard.sh',
);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('typed dashboard rollback primitive', () => {
  it('atomically restores the retained target without overwriting production rollback evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'dashboard-rollback-fixture-'));
    roots.push(root);
    const dashboard = join(root, 'apps/dashboard');
    const live = join(dashboard, 'dist');
    const target = join(dashboard, '.dist-releases/prod-cecelia-v41');
    const rollbackDir = join(root, 'logs/release-rollbacks/dashboard');
    const fakeBin = join(root, 'bin');
    const releaseRunId = '44444444-4444-4444-8444-444444444444';
    mkdirSync(live, { recursive: true });
    mkdirSync(target, { recursive: true });
    mkdirSync(rollbackDir, { recursive: true });
    mkdirSync(fakeBin);
    writeFileSync(join(live, 'index.html'), 'current-v42');
    writeFileSync(join(target, 'index.html'), 'prior-v41');
    writeFileSync(join(root, '.production-release'), [
      'current=prod-cecelia-v42',
      `commit=${'f'.repeat(40)}`,
      'manifest=prod-cecelia-v41 brain_image=old dashboard_release=prod-cecelia-v41 commit=11111111',
      'manifest=prod-cecelia-v42 brain_image=new dashboard_release=prod-cecelia-v42 commit=ffffffff',
      '',
    ].join('\n'));
    const evidence = join(rollbackDir, `${releaseRunId}.json`);
    writeFileSync(evidence, 'immutable-production-evidence');
    const fakeNode = join(fakeBin, 'node');
    writeFileSync(fakeNode, `#!/usr/bin/env bash
if [[ "\${1:-}" == *verify-release-rollback-worker.mjs ]]; then exit 0; fi
exec "$REAL_NODE" "$@"
`);
    chmodSync(fakeNode, 0o755);

    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      REAL_NODE: process.execPath,
      KERNEL_RELEASE_DEPLOY_ROOT: root,
      KERNEL_RELEASE_RUN_ID: releaseRunId,
      KERNEL_RELEASE_MERGE_SHA: 'f'.repeat(40),
      KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(root, 'private.json'),
      KERNEL_RELEASE_ROLLBACK_WORKER: '1',
      KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
        '66666666-6666-4666-8666-666666666666',
      KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
        '77777777-7777-4777-8777-777777777777',
      KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
      KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
      KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST: digestTree(target),
      KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST: digestTree(live),
      KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_VERSION: 'prod-cecelia-v42',
      KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_MERGE_SHA: 'f'.repeat(40),
      KERNEL_RELEASE_ROLLBACK_TARGET_MERGE_SHA: 'a'.repeat(40),
      CECELIA_SKIP_BRAIN_PROMOTE: '1',
      CECELIA_SKIP_HK: '1',
      CECELIA_SKIP_FINGERPRINT: '1',
      CECELIA_SKIP_GIT_TAG: '1',
    };
    const staleAuthority = spawnSync(
      'bash',
      [script, '--rollback', 'prod-cecelia-v41'],
      {
        env: {
          ...env,
          KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
            `sha256:${'0'.repeat(64)}`,
        },
        encoding: 'utf8',
      },
    );
    expect(staleAuthority.status, staleAuthority.stderr).toBe(78);
    expect(staleAuthority.stderr).toContain('current production CAS mismatch');
    expect(readFileSync(join(live, 'index.html'), 'utf8')).toBe('current-v42');

    const result = spawnSync('bash', [script, '--rollback', 'prod-cecelia-v41'], {
      env,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(live, 'index.html'), 'utf8')).toBe('prior-v41');
    expect(readFileSync(join(root, '.production-release'), 'utf8'))
      .toContain('current=prod-cecelia-v41');
    expect(readFileSync(join(root, '.production-release'), 'utf8'))
      .toContain(`commit=${'a'.repeat(40)}`);
    expect(readFileSync(evidence, 'utf8')).toBe('immutable-production-evidence');

    writeFileSync(join(live, 'index.html'), 'current-v42');
    const missingTargetSha = spawnSync(
      'bash',
      [script, '--rollback', 'prod-cecelia-v41'],
      {
        env: {
          ...env,
          KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST: digestTree(live),
          KERNEL_RELEASE_ROLLBACK_TARGET_MERGE_SHA: '',
        },
        encoding: 'utf8',
      },
    );
    expect(missingTargetSha.status, missingTargetSha.stderr).toBe(78);
    expect(readFileSync(join(live, 'index.html'), 'utf8')).toBe('current-v42');

    writeFileSync(join(live, 'index.html'), 'must-survive-failed-preflight');
    writeFileSync(join(target, 'index.html'), 'tampered-prior-v41');
    const rejected = spawnSync(
      'bash',
      [script, '--rollback', 'prod-cecelia-v41'],
      { env, encoding: 'utf8' },
    );
    expect(rejected.status, rejected.stderr).toBe(78);
    expect(rejected.stderr).toContain('retained target digest mismatch');
    expect(readFileSync(join(live, 'index.html'), 'utf8'))
      .toBe('must-survive-failed-preflight');
    expect(readFileSync(evidence, 'utf8')).toBe('immutable-production-evidence');
  });
});
