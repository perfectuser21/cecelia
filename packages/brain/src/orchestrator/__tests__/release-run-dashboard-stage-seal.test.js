import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  sealDashboardStage,
} from '../../../../../scripts/lib/release-run-dashboard-stage-seal.mjs';
import { digestTree } from '../../../../../scripts/lib/release-run-tree-digest.mjs';

const promoteScript = resolve(
  import.meta.dirname,
  '../../../../../scripts/promote-dashboard.sh',
);
const slotServer = resolve(
  import.meta.dirname,
  '../../../../../scripts/dashboard-slot-server.cjs',
);
const roots = [];
const childProcesses = [];
const mergeSha = 'b'.repeat(40);
const previousSha = 'a'.repeat(40);
const artifactVersion = mergeSha.slice(0, 12);
const sourceDigest = `sha256:${'7'.repeat(64)}`;

function writePending(pendingPath, stagingRoot, {
  commit = mergeSha,
  deployedDigest = digestTree(stagingRoot),
  slotPid = '999999',
  slotNonce = '1'.repeat(64),
} = {}) {
  writeFileSync(pendingPath, [
    `staging_dist=${stagingRoot}`,
    'staging_port=5223',
    `slot_pid=${slotPid}`,
    `slot_nonce=${slotNonce}`,
    `commit=${commit}`,
    'created_at=2026-07-28T15:00:00Z',
    'artifact_name=workspace',
    `artifact_version=${artifactVersion}`,
    `source_digest=${sourceDigest}`,
    `staged_deployed_digest=${deployedDigest}`,
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(pendingPath, 0o600);
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-stage-seal-'));
  roots.push(root);
  const dashboard = join(root, 'apps/dashboard');
  const staging = join(dashboard, '.dist-staging');
  const live = join(dashboard, 'dist');
  const pending = join(dashboard, '.staging-pending');
  const fakeBin = join(root, 'bin');
  mkdirSync(staging, { recursive: true });
  mkdirSync(live, { recursive: true });
  mkdirSync(fakeBin);
  writeFileSync(join(staging, 'index.html'), '<h1>target</h1>\n');
  writeFileSync(
    join(staging, 'build-info.json'),
    JSON.stringify({ git_sha: mergeSha }),
  );
  writeFileSync(join(live, 'index.html'), '<h1>old</h1>\n');
  writeFileSync(
    join(live, 'build-info.json'),
    JSON.stringify({ git_sha: previousSha }),
  );
  writeFileSync(join(root, '.production-release'), [
    'current=prod-cecelia-v1',
    `commit=${previousSha}`,
    'manifest=prod-cecelia-v1 brain_image=old dashboard_release=prod-cecelia-v1 commit=aaaaaaaa',
    '',
  ].join('\n'));
  const fakeCurl = join(fakeBin, 'curl');
  writeFileSync(fakeCurl, `#!/usr/bin/env bash
set -euo pipefail
out=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then out="$2"; shift 2; continue; fi
  shift
done
printf '{"authorized":true}' > "$out"
printf '200'
`);
  chmodSync(fakeCurl, 0o755);
  return {
    root,
    dashboard,
    staging,
    live,
    pending,
    fakeBin,
  };
}

afterEach(() => {
  for (const child of childProcesses.splice(0)) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sealed Dashboard staging identity', () => {
  it('seals an exact stage and remains immutable after the live staging tree changes', () => {
    const fixture = makeFixture();
    writePending(fixture.pending, fixture.staging);
    const result = sealDashboardStage({
      pendingPath: fixture.pending,
      stagingRoot: fixture.staging,
      sealParent: fixture.dashboard,
      expectedMergeSha: mergeSha,
      expectedArtifactName: 'workspace',
      expectedArtifactVersion: artifactVersion,
      expectedSourceDigest: sourceDigest,
    });
    const sealedDigest = digestTree(result.sealedRoot);
    writeFileSync(join(fixture.staging, 'index.html'), '<h1>replaced</h1>\n');
    expect(digestTree(result.sealedRoot)).toBe(sealedDigest);
    expect(result).toMatchObject({
      commit: mergeSha,
      artifactName: 'workspace',
      artifactVersion,
      sourceDigest,
    });
  });

  it('rejects an old SHA and detects source or pending replacement during sealing', () => {
    const fixture = makeFixture();
    writeFileSync(
      join(fixture.staging, 'build-info.json'),
      JSON.stringify({ git_sha: '1'.repeat(40) }),
    );
    writePending(fixture.pending, fixture.staging, {
      commit: '1'.repeat(40),
    });
    expect(() => sealDashboardStage({
      pendingPath: fixture.pending,
      stagingRoot: fixture.staging,
      sealParent: fixture.dashboard,
      expectedMergeSha: mergeSha,
      expectedArtifactName: 'workspace',
      expectedArtifactVersion: artifactVersion,
      expectedSourceDigest: sourceDigest,
    })).toThrow('release_dashboard_stage_identity_mismatch');

    writeFileSync(
      join(fixture.staging, 'build-info.json'),
      JSON.stringify({ git_sha: mergeSha }),
    );
    writePending(fixture.pending, fixture.staging);
    writeFileSync(
      fixture.pending,
      readFileSync(fixture.pending, 'utf8').replace(
        'slot_pid=999999',
        'slot_pid=-1',
      ),
      { mode: 0o600 },
    );
    expect(() => sealDashboardStage({
      pendingPath: fixture.pending,
      stagingRoot: fixture.staging,
      sealParent: fixture.dashboard,
      expectedMergeSha: mergeSha,
      expectedArtifactName: 'workspace',
      expectedArtifactVersion: artifactVersion,
      expectedSourceDigest: sourceDigest,
    })).toThrow('release_dashboard_stage_identity_mismatch');

    writePending(fixture.pending, fixture.staging);
    expect(() => sealDashboardStage({
      pendingPath: fixture.pending,
      stagingRoot: fixture.staging,
      sealParent: fixture.dashboard,
      expectedMergeSha: mergeSha,
      expectedArtifactName: 'workspace',
      expectedArtifactVersion: artifactVersion,
      expectedSourceDigest: sourceDigest,
      afterCopy: () => {
        writeFileSync(join(fixture.staging, 'index.html'), 'raced\n');
        writeFileSync(fixture.pending, 'replaced=true\n', { mode: 0o600 });
      },
    })).toThrow('release_dashboard_stage_changed_during_seal');
    expect(readdirSync(fixture.dashboard).filter(
      (entry) => entry.startsWith('.staging-sealed-'),
    )).toHaveLength(0);
  });

  it('fails old-SHA promotion before effect and promotes the exact sealed stage', () => {
    const stale = makeFixture();
    writeFileSync(
      join(stale.staging, 'build-info.json'),
      JSON.stringify({ git_sha: '1'.repeat(40) }),
    );
    writePending(stale.pending, stale.staging, { commit: '1'.repeat(40) });
    const env = {
      ...process.env,
      PATH: `${stale.fakeBin}:${process.env.PATH}`,
      KERNEL_RELEASE_DEPLOY_ROOT: stale.root,
      KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
      KERNEL_RELEASE_MERGE_SHA: mergeSha,
      KERNEL_RELEASE_AUTHORIZATION:
        '55555555-5555-4555-8555-555555555555',
      KERNEL_RELEASE_ARTIFACT_NAME: 'workspace',
      KERNEL_RELEASE_ARTIFACT_VERSION: artifactVersion,
      KERNEL_RELEASE_ARTIFACT_DIGEST: sourceDigest,
      DEPLOY_TOKEN: 'test-token',
      BRAIN_URL: 'http://brain.test',
      CECELIA_SKIP_BRAIN_PROMOTE: '1',
      CECELIA_SKIP_HK: '1',
      CECELIA_SKIP_FINGERPRINT: '1',
      CECELIA_SKIP_GIT_TAG: '1',
    };
    const rejected = spawnSync('bash', [promoteScript], {
      env,
      encoding: 'utf8',
    });
    expect(rejected.status, rejected.stderr).toBe(78);
    expect(readFileSync(join(stale.live, 'index.html'), 'utf8'))
      .toContain('old');
    const staleReleases = join(stale.dashboard, '.dist-releases');
    expect(
      existsSync(staleReleases) ? readdirSync(staleReleases) : [],
    ).not.toContain('prod-cecelia-v2');
    expect(readFileSync(join(stale.root, '.production-release'), 'utf8'))
      .toContain(`commit=${previousSha}`);

    const exact = makeFixture();
    const unrelated = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ], { stdio: 'ignore' });
    childProcesses.push(unrelated);
    writePending(exact.pending, exact.staging, {
      slotPid: String(unrelated.pid),
    });
    const accepted = spawnSync('bash', [promoteScript], {
      env: {
        ...env,
        PATH: `${exact.fakeBin}:${process.env.PATH}`,
        KERNEL_RELEASE_DEPLOY_ROOT: exact.root,
      },
      encoding: 'utf8',
    });
    expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0);
    expect(readFileSync(join(exact.live, 'build-info.json'), 'utf8'))
      .toContain(mergeSha);
    expect(readFileSync(join(exact.root, '.production-release'), 'utf8'))
      .toContain(`commit=${mergeSha}`);
    const receipt = JSON.parse(readFileSync(join(
      exact.root,
      'logs/release-rollbacks/dashboard',
      '44444444-4444-4444-8444-444444444444.json',
    )));
    expect(receipt).toMatchObject({
      merge_sha: mergeSha,
      current_version: artifactVersion,
      current_digest: sourceDigest,
      current_deployed_digest: digestTree(exact.live),
    });
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
  });

  it('rejects even an exact retained release and never kills an unverified reused PID', () => {
    const fixture = makeFixture();
    const retained = join(
      fixture.dashboard,
      '.dist-releases/prod-cecelia-v9',
    );
    mkdirSync(join(fixture.dashboard, '.dist-releases'), { recursive: true });
    cpSync(fixture.staging, retained, { recursive: true });
    const unrelated = spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ], { stdio: 'ignore' });
    childProcesses.push(unrelated);
    writePending(fixture.pending, fixture.staging, {
      slotPid: String(unrelated.pid),
    });
    const rejected = spawnSync('bash', [promoteScript, '--deploy', 'prod-cecelia-v9'], {
      env: {
        ...process.env,
        PATH: `${fixture.fakeBin}:${process.env.PATH}`,
        KERNEL_RELEASE_DEPLOY_ROOT: fixture.root,
        KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
        KERNEL_RELEASE_MERGE_SHA: mergeSha,
        KERNEL_RELEASE_AUTHORIZATION:
          '55555555-5555-4555-8555-555555555555',
        KERNEL_RELEASE_ARTIFACT_NAME: 'workspace',
        KERNEL_RELEASE_ARTIFACT_VERSION: artifactVersion,
        KERNEL_RELEASE_ARTIFACT_DIGEST: sourceDigest,
        DEPLOY_TOKEN: 'test-token',
        BRAIN_URL: 'http://brain.test',
        CECELIA_SKIP_BRAIN_PROMOTE: '1',
        CECELIA_SKIP_HK: '1',
        CECELIA_SKIP_FINGERPRINT: '1',
        CECELIA_SKIP_GIT_TAG: '1',
      },
      encoding: 'utf8',
    });
    expect(rejected.status, `${rejected.stdout}\n${rejected.stderr}`).toBe(78);
    expect(readFileSync(join(fixture.live, 'build-info.json'), 'utf8'))
      .toContain(previousSha);
    expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
    unrelated.kill('SIGTERM');
  });

  it('lets only the exact slot identity ask the slot to stop itself', async () => {
    const fixture = makeFixture();
    const { createServer } = await import('node:net');
    const port = await new Promise((resolvePort, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolvePort(address.port));
      });
    });
    const nonce = '2'.repeat(64);
    const child = spawn(process.execPath, [slotServer], {
      env: {
        ...process.env,
        DIST_DIR: fixture.staging,
        SLOT_HOST: '127.0.0.1',
        SLOT_PORT: String(port),
        STAGING_BANNER: '1',
        STAGING_COMMIT: mergeSha,
        STAGING_SLOT_NONCE: nonce,
      },
      stdio: 'ignore',
    });
    childProcesses.push(child);
    let identity;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/.cecelia-staging-identity`,
          {
            headers: {
              'X-Cecelia-Slot-Nonce': nonce,
              'X-Cecelia-Slot-Commit': mergeSha,
            },
          },
        );
        if (response.ok) {
          identity = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    expect(identity).toEqual({
      pid: child.pid,
      nonce,
      commit: mergeSha,
    });
    const denied = await fetch(
      `http://127.0.0.1:${port}/.cecelia-staging-shutdown`,
      {
        method: 'POST',
        headers: {
          'X-Cecelia-Slot-Nonce': '3'.repeat(64),
          'X-Cecelia-Slot-Commit': mergeSha,
        },
      },
    );
    expect(denied.status).toBe(403);
    expect(() => process.kill(child.pid, 0)).not.toThrow();
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
    const accepted = await fetch(
      `http://127.0.0.1:${port}/.cecelia-staging-shutdown`,
      {
        method: 'POST',
        headers: {
          'X-Cecelia-Slot-Nonce': nonce,
          'X-Cecelia-Slot-Commit': mergeSha,
        },
      },
    );
    expect(accepted.status).toBe(202);
    await exited;
    expect(() => process.kill(child.pid, 0)).toThrow();
  });
});
