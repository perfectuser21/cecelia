import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('Brain exact runtime image contract wiring', () => {
  it('keeps one Brain copy while closing the complete Engine package graph', () => {
    expect(dockerfile).toContain('COPY packages/engine/ /engine/');
    expect(dockerfile).toMatch(
      /WORKDIR \/app[\s\S]*RUN ln -s \/app \/brain/,
    );
    expect(dockerfile).not.toContain('COPY packages/brain/ /brain/');
  });

  it('builds and verifies the same exact Git SHA in Docker CI', () => {
    const dockerJob = job('docker-infra-smoke', 'secrets-scan');

    expect(dockerJob).toMatch(
      /docker build[\s\S]*--build-arg GIT_SHA="\$\{\{ github\.sha \}\}"[\s\S]*-t cecelia-brain:ci/,
    );
    expect(dockerJob).toMatch(
      /brain-runtime-image-contract\.mjs[\s\S]*--image cecelia-brain:ci[\s\S]*--expected-git-sha "\$\{\{ github\.sha \}\}"[\s\S]*--require-docker/,
    );
  });

  it('reruns Docker infrastructure when the runtime contract changes', () => {
    expect(job('changes', 'docker-infra-smoke')).toContain(
      'scripts/ci/brain-runtime-image-contract\\.mjs',
    );
  });
});
