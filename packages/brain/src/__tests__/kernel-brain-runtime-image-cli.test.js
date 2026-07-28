import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runtimeContract = new URL(
  '../../../../scripts/ci/brain-runtime-image-contract.mjs',
  import.meta.url,
);
const SHA = 'a'.repeat(40);

function run(args, env = process.env) {
  return spawnSync(process.execPath, [
    runtimeContract.pathname,
    ...args,
  ], {
    encoding: 'utf8',
    env,
    timeout: 5_000,
  });
}

describe('Brain exact runtime image CLI', () => {
  it.each([
    ['--allow-skip', 0, 'SKIP brain_runtime_image_contract docker_unavailable_explicit'],
    ['--require-docker', 1, 'docker_required_but_unavailable'],
  ])(
    'makes Docker absence explicit with %s',
    (mode, status, message) => {
      const result = run([
        '--image',
        'cecelia-brain:test',
        '--expected-git-sha',
        SHA,
        mode,
      ], {
        ...process.env,
        PATH: '/kernel-equivalence-no-docker',
      });

      expect(result.status).toBe(status);
      expect(`${result.stdout}${result.stderr}`).toContain(message);
    },
  );

  it.each([
    'unknown',
    'abc123',
    `${'A'.repeat(40)}`,
  ])('rejects a non-exact Git SHA: %s', (sha) => {
    const result = run([
      '--image',
      'cecelia-brain:test',
      '--expected-git-sha',
      sha,
      '--allow-skip',
    ]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      'brain_runtime_image_contract_usage: expected Git SHA is invalid',
    );
  });
});
