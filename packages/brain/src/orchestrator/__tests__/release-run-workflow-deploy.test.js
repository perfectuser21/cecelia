import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const deployScript = resolve(
  import.meta.dirname,
  '../../../../../packages/workflows/scripts/deploy-workflow-skills.sh',
);
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Workflow Skills ReleaseRun deployment', () => {
  it('atomically links the immutable snapshot and retains the exact prior target', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workflow-release-fixture-'));
    temporaryRoots.push(fixture);
    const deployRoot = join(fixture, 'deploy');
    const artifactRoot = join(fixture, 'artifacts', 'b'.repeat(40));
    const accountRoot = join(fixture, 'account');
    const skillRoot = join(artifactRoot, 'packages/workflows/skills/example');
    const priorSkill = join(fixture, 'prior/example');
    const fakeBin = join(fixture, 'bin');
    mkdirSync(skillRoot, { recursive: true });
    mkdirSync(priorSkill, { recursive: true });
    mkdirSync(join(accountRoot, 'skills'), { recursive: true });
    mkdirSync(fakeBin);
    mkdirSync(deployRoot);
    writeFileSync(join(skillRoot, 'SKILL.md'), '# exact\n');
    writeFileSync(join(priorSkill, 'SKILL.md'), '# prior\n');
    writeFileSync(join(artifactRoot, '.release-snapshot.json'), JSON.stringify({
      schema_version: 1,
      merge_sha: 'b'.repeat(40),
      source: 'git-archive',
    }));
    symlinkSync(priorSkill, join(accountRoot, 'skills/example'));
    const curl = join(fakeBin, 'curl');
    writeFileSync(curl, `#!/usr/bin/env bash
out=""
previous=""
for arg in "$@"; do
  [[ "$previous" == "--output" ]] && out="$arg"
  previous="$arg"
done
printf '{"authorized":true}' > "$out"
printf 200
`);
    chmodSync(curl, 0o755);

    const releaseRunId = '44444444-4444-4444-8444-444444444444';
    const result = spawnSync('bash', [deployScript], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        KERNEL_RELEASE_RUN_ID: releaseRunId,
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_AUTHORIZATION: '55555555-5555-4555-8555-555555555555',
        KERNEL_RELEASE_EFFECT_KIND: 'production',
        KERNEL_RELEASE_DEPLOY_ROOT: deployRoot,
        KERNEL_RELEASE_ARTIFACT_ROOT: artifactRoot,
        KERNEL_RELEASE_ARTIFACT_VERSIONS: JSON.stringify([{
          name: 'workflow-skills',
          version: 'b'.repeat(12),
          digest: `sha256:${'9'.repeat(64)}`,
        }]),
        CECELIA_SKILLS_DEPLOY_ROOTS: accountRoot,
        DEPLOY_TOKEN: 'fixture-token',
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(accountRoot, 'skills/example'))).toBe(skillRoot);
    const manifest = readFileSync(
      join(
        deployRoot,
        `logs/release-rollbacks/workflow-skills/${releaseRunId}.links`,
      ),
      'utf8',
    );
    expect(manifest).toContain(`${join(accountRoot, 'skills/example')}\t${priorSkill}`);
    expect(JSON.parse(readFileSync(
      join(
        deployRoot,
        `logs/release-rollbacks/workflow-skills/${releaseRunId}.json`,
      ),
      'utf8',
    ))).toEqual({
      anchor: `workflow-skills:sha256:${'9'.repeat(64)}`,
      previous_version: expect.stringMatching(/^workflow-skills:sha256:[0-9a-f]{64}$/),
      previous_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });
});
