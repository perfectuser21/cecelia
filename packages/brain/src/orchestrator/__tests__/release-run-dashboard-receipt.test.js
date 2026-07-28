import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestTree } from '../../../../../scripts/lib/release-run-tree-digest.mjs';

const helper = resolve(
  import.meta.dirname,
  '../../../../../scripts/lib/release-run-dashboard-receipt.mjs',
);
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('dashboard ReleaseRun rollback receipt', () => {
  it('writes the real typed format with the exact old tag and tree digest', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dashboard-rollback-fixture-'));
    temporaryRoots.push(fixture);
    const oldRoot = join(fixture, 'prod-cecelia-v41');
    const newRoot = join(fixture, 'dist');
    const receiptPath = join(fixture, 'receipts/release.json');
    mkdirSync(oldRoot);
    mkdirSync(newRoot);
    writeFileSync(join(oldRoot, 'index.html'), '<h1>old</h1>\n');
    writeFileSync(join(newRoot, 'index.html'), '<h1>new</h1>\n');
    writeFileSync(
      join(newRoot, 'build-info.json'),
      JSON.stringify({ git_sha: 'b'.repeat(40) }),
    );
    const deployedDigest = digestTree(newRoot);

    execFileSync(process.execPath, [helper], {
      env: {
        ...process.env,
        KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_ARTIFACT_VERSION: 'b'.repeat(12),
        KERNEL_RELEASE_ARTIFACT_DIGEST: `sha256:${'7'.repeat(64)}`,
        KERNEL_RELEASE_ARTIFACT_DEPLOYED_DIGEST: deployedDigest,
        RELEASE_DASHBOARD_OLD_TAG: 'prod-cecelia-v41',
        RELEASE_DASHBOARD_NEW_TAG: 'prod-cecelia-v42',
        RELEASE_DASHBOARD_OLD_COMMIT: 'a'.repeat(40),
        RELEASE_DASHBOARD_OLD_ROOT: oldRoot,
        RELEASE_DASHBOARD_NEW_ROOT: newRoot,
        RELEASE_DASHBOARD_RECEIPT: receiptPath,
      },
    });

    expect(JSON.parse(readFileSync(receiptPath, 'utf8'))).toEqual({
      schema_version: 1,
      release_run_id: '44444444-4444-4444-8444-444444444444',
      merge_sha: 'b'.repeat(40),
      artifact_name: 'workspace',
      current_version: 'b'.repeat(12),
      current_digest: `sha256:${'7'.repeat(64)}`,
      current_deployed_digest: deployedDigest,
      old_tag: 'prod-cecelia-v41',
      new_tag: 'prod-cecelia-v42',
      anchor: `workspace:sha256:${'7'.repeat(64)}`,
      previous_version: 'dashboard:prod-cecelia-v41',
      previous_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      previous_merge_sha: 'a'.repeat(40),
    });
  });
});
