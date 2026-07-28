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

const script = resolve(
  import.meta.dirname,
  '../../../../../scripts/brain-rollback.sh',
);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('typed Brain rollback primitive', () => {
  it('resolves compose relative paths against the mounted deployment root', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).toContain('--project-directory "$ROOT_DIR"');
    expect(source).toContain('-f "$IMMUTABLE_COMPOSE_FILE"');
    expect(source).toContain('--env-file "$ROOT_DIR/.env.docker"');
  });

  it('rejects a changed source image before invoking docker compose', () => {
    const root = mkdtempSync(join(tmpdir(), 'brain-rollback-preflight-'));
    roots.push(root);
    const fakeBin = join(root, 'bin');
    const calls = join(root, 'docker.calls');
    mkdirSync(fakeBin);
    writeFileSync(join(root, '.brain-versions'), 'rollback-aaaaaaaaaaaa\n');
    writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');
    writeFileSync(join(fakeBin, 'node'), `#!/usr/bin/env bash
if [[ "\${1:-}" == *verify-release-rollback-worker.mjs ]]; then exit 0; fi
exec "$REAL_NODE" "$@"
`);
    writeFileSync(join(fakeBin, 'docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
if [[ "$*" == *"--format"* ]]; then printf '%s\\n' "$FAKE_IMAGE_DIGEST"; fi
`);
    for (const name of ['node', 'docker']) chmodSync(join(fakeBin, name), 0o755);

    const result = spawnSync('bash', [script, 'rollback-aaaaaaaaaaaa'], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        DOCKER_CALLS: calls,
        FAKE_IMAGE_DIGEST: `sha256:${'b'.repeat(64)}`,
        KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
          `sha256:${'b'.repeat(64)}`,
        KERNEL_RELEASE_DEPLOY_ROOT: root,
        KERNEL_RELEASE_RUN_ID: '44444444-4444-4444-8444-444444444444',
        KERNEL_RELEASE_MERGE_SHA: 'f'.repeat(40),
        KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(root, 'private.json'),
        KERNEL_RELEASE_ROLLBACK_WORKER: '1',
        KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
          '66666666-6666-4666-8666-666666666666',
        KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
          '77777777-7777-4777-8777-777777777777',
        KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
        KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
        KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST: `sha256:${'a'.repeat(64)}`,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain(
      'Rollback image digest does not match durable authority',
    );
    expect(readFileSync(calls, 'utf8')).not.toContain('compose');
  });
});
