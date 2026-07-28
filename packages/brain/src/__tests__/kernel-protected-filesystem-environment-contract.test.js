import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const imageContract = new URL(
  '../../../../scripts/ci/kernel-protected-filesystem-image-contract.mjs',
  import.meta.url,
);
const dockerfile = readFileSync(
  new URL('../../Dockerfile', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

function job(name, nextName) {
  const start = workflow.indexOf(`  ${name}:`);
  const end = workflow.indexOf(`  ${nextName}:`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe('Kernel protected filesystem runtime dependencies', () => {
  it('installs Alpine acl and attr in the Brain runtime image', () => {
    const runtime = dockerfile.slice(
      dockerfile.indexOf('FROM node:20-alpine\n'),
    );

    expect(runtime).toMatch(
      /RUN apk add --no-cache [^\n]*\bacl\b[^\n]*\battr\b/,
    );
  });

  it.each([
    ['brain-unit', 'brain-unit-all'],
    ['brain-integration', 'workspace-build'],
  ])(
    'installs acl and attr explicitly in the Ubuntu %s job',
    (name, nextName) => {
      expect(job(name, nextName)).toContain(
        'sudo apt-get install -y --no-install-recommends acl attr',
      );
    },
  );

  it('runs the exact image behavior contract with Docker required', () => {
    expect(job('docker-infra-smoke', 'secrets-scan')).toMatch(
      /kernel-protected-filesystem-image-contract\.mjs[\s\S]*--image cecelia-brain:ci[\s\S]*--require-docker/,
    );
  });

  it('reruns Docker infrastructure when the image contract changes', () => {
    expect(job('changes', 'docker-infra-smoke')).toContain(
      'scripts/ci/kernel-protected-filesystem-image-contract\\.mjs',
    );
  });

  it.each([
    ['--allow-skip', 0, 'SKIP kernel_fs_image_contract docker_unavailable_explicit'],
    ['--require-docker', 1, 'docker_required_but_unavailable'],
  ])(
    'makes Docker absence explicit with %s',
    (mode, status, message) => {
      const result = spawnSync(process.execPath, [
        imageContract.pathname,
        '--image',
        'cecelia-brain:test',
        mode,
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: '/kernel-equivalence-no-docker',
        },
      });

      expect(result.status).toBe(status);
      expect(`${result.stdout}${result.stderr}`).toContain(message);
    },
  );
});
