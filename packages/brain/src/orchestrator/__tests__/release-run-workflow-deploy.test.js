import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
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
    spawnSync('chmod', ['-R', 'u+w', root]);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Workflow Skills ReleaseRun deployment', () => {
  it('links a persistent immutable release and replays without replacing the first rollback manifest', () => {
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
    const env = {
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
    };
    const result = spawnSync('bash', [deployScript], {
      env,
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    const liveSkill = join(accountRoot, 'skills/example');
    const persistentSkill = join(
      accountRoot,
      '.kernel-releases/workflow-skills',
      releaseRunId,
      'example',
    );
    expect(readlinkSync(liveSkill)).toBe(persistentSkill);
    expect(statSync(persistentSkill).mode & 0o222).toBe(0);
    expect(statSync(join(persistentSkill, 'SKILL.md')).mode & 0o222).toBe(0);
    const manifestPath = join(
      deployRoot,
      `logs/release-rollbacks/workflow-skills/${releaseRunId}.links`,
    );
    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain(`${join(accountRoot, 'skills/example')}\t${priorSkill}`);

    const replay = spawnSync('bash', [deployScript], {
      env,
      encoding: 'utf8',
    });
    expect(replay.status, replay.stderr).toBe(0);
    expect(readFileSync(manifestPath, 'utf8')).toBe(manifest);

    rmSync(artifactRoot, { recursive: true, force: true });
    expect(existsSync(readlinkSync(liveSkill))).toBe(true);
    expect(readFileSync(join(readlinkSync(liveSkill), 'SKILL.md'), 'utf8'))
      .toBe('# exact\n');
    expect(JSON.parse(readFileSync(
      join(
        deployRoot,
        `logs/release-rollbacks/workflow-skills/${releaseRunId}.json`,
      ),
      'utf8',
    ))).toEqual({
      anchor: `workflow-skills:sha256:${'9'.repeat(64)}`,
      current_links_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      previous_version: expect.stringMatching(/^workflow-skills:sha256:[0-9a-f]{64}$/),
      previous_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it('restores the exact retained link manifest only through rollback authority', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workflow-rollback-fixture-'));
    temporaryRoots.push(fixture);
    const deployRoot = join(fixture, 'deploy');
    const accountRoot = join(fixture, 'account');
    const currentSkill = join(fixture, 'current/example');
    const priorSkill = join(fixture, 'prior/example');
    const liveSkill = join(accountRoot, 'skills/example');
    const fakeBin = join(fixture, 'bin');
    const releaseRunId = '44444444-4444-4444-8444-444444444444';
    const rollbackDir = join(
      deployRoot,
      'logs/release-rollbacks/workflow-skills',
    );
    mkdirSync(currentSkill, { recursive: true });
    mkdirSync(priorSkill, { recursive: true });
    mkdirSync(join(accountRoot, 'skills'), { recursive: true });
    mkdirSync(rollbackDir, { recursive: true });
    mkdirSync(fakeBin);
    symlinkSync(currentSkill, liveSkill);
    const manifest = `${liveSkill}\t${priorSkill}\n`;
    const manifestPath = join(rollbackDir, `${releaseRunId}.links`);
    writeFileSync(manifestPath, manifest, { mode: 0o600 });
    const expectedDigest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
    const fakeNode = join(fakeBin, 'node');
    writeFileSync(fakeNode, `#!/usr/bin/env bash
if [[ "\${1:-}" == *verify-release-rollback-worker.mjs ]]; then exit 0; fi
exec "$REAL_NODE" "$@"
`);
    chmodSync(fakeNode, 0o755);

    const result = spawnSync('bash', [deployScript, '--rollback', releaseRunId], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        KERNEL_RELEASE_DEPLOY_ROOT: deployRoot,
        KERNEL_RELEASE_RUN_ID: releaseRunId,
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(fixture, 'private.json'),
        KERNEL_RELEASE_ROLLBACK_WORKER: '1',
        KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
          '66666666-6666-4666-8666-666666666666',
        KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
          '77777777-7777-4777-8777-777777777777',
        KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
        KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
        KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST: expectedDigest,
        KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
          `sha256:${createHash('sha256')
            .update(`${liveSkill}\t${currentSkill}\n`).digest('hex')}`,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(liveSkill)).toBe(priorSkill);
  });

  it('preflights every live parent before changing any earlier link', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workflow-rollback-preflight-'));
    temporaryRoots.push(fixture);
    const deployRoot = join(fixture, 'deploy');
    const accountRoot = join(fixture, 'account');
    const currentOne = join(fixture, 'current/one');
    const priorOne = join(fixture, 'prior/one');
    const priorTwo = join(fixture, 'prior/two');
    const liveOne = join(accountRoot, 'skills/one');
    const liveTwo = join(fixture, 'deleted-account/skills/two');
    const fakeBin = join(fixture, 'bin');
    const releaseRunId = '44444444-4444-4444-8444-444444444444';
    const rollbackDir = join(
      deployRoot,
      'logs/release-rollbacks/workflow-skills',
    );
    for (const directory of [
      currentOne,
      priorOne,
      priorTwo,
      join(accountRoot, 'skills'),
      rollbackDir,
      fakeBin,
    ]) mkdirSync(directory, { recursive: true });
    symlinkSync(currentOne, liveOne);
    const manifest = [
      `${liveOne}\t${priorOne}`,
      `${liveTwo}\t${priorTwo}`,
      '',
    ].join('\n');
    writeFileSync(join(rollbackDir, `${releaseRunId}.links`), manifest, {
      mode: 0o600,
    });
    const fakeNode = join(fakeBin, 'node');
    writeFileSync(fakeNode, `#!/usr/bin/env bash
if [[ "\${1:-}" == *verify-release-rollback-worker.mjs ]]; then exit 0; fi
exec "$REAL_NODE" "$@"
`);
    chmodSync(fakeNode, 0o755);

    const result = spawnSync('bash', [deployScript, '--rollback', releaseRunId], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        KERNEL_RELEASE_DEPLOY_ROOT: deployRoot,
        KERNEL_RELEASE_RUN_ID: releaseRunId,
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(fixture, 'private.json'),
        KERNEL_RELEASE_ROLLBACK_WORKER: '1',
        KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
          '66666666-6666-4666-8666-666666666666',
        KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
          '77777777-7777-4777-8777-777777777777',
        KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
        KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
        KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:
          `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
        KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
          `sha256:${createHash('sha256').update([
            `${liveOne}\t${currentOne}`,
            `${liveTwo}\tabsent`,
            '',
          ].join('\n')).digest('hex')}`,
      },
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(78);
    expect(result.stderr).toContain('unmanaged live path');
    expect(readlinkSync(liveOne)).toBe(currentOne);
  });

  it('compensates earlier links when a later atomic replacement fails', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'workflow-rollback-compensation-'));
    temporaryRoots.push(fixture);
    const deployRoot = join(fixture, 'deploy');
    const skillsRoot = join(fixture, 'account/skills');
    const fakeBin = join(fixture, 'bin');
    const releaseRunId = '44444444-4444-4444-8444-444444444444';
    const rollbackDir = join(
      deployRoot,
      'logs/release-rollbacks/workflow-skills',
    );
    const values = Object.fromEntries(
      ['current-one', 'current-two', 'prior-one', 'prior-two'].map(
        (name) => [name, join(fixture, name)],
      ),
    );
    for (const directory of [
      skillsRoot,
      fakeBin,
      rollbackDir,
      ...Object.values(values),
    ]) mkdirSync(directory, { recursive: true });
    const liveOne = join(skillsRoot, 'one');
    const liveTwo = join(skillsRoot, 'two');
    symlinkSync(values['current-one'], liveOne);
    symlinkSync(values['current-two'], liveTwo);
    const manifest = [
      `${liveOne}\t${values['prior-one']}`,
      `${liveTwo}\t${values['prior-two']}`,
      '',
    ].join('\n');
    writeFileSync(join(rollbackDir, `${releaseRunId}.links`), manifest, {
      mode: 0o600,
    });
    const currentManifest = [
      `${liveOne}\t${values['current-one']}`,
      `${liveTwo}\t${values['current-two']}`,
      '',
    ].join('\n');
    const fakeNode = join(fakeBin, 'node');
    writeFileSync(fakeNode, `#!/usr/bin/env bash
if [[ "\${1:-}" == *verify-release-rollback-worker.mjs ]]; then exit 0; fi
if [[ "\${4:-}" == "$FAIL_LIVE" && "\${3:-}" == *.rollback-next.* ]]; then exit 1; fi
if [[ "\${4:-}" == "$FAIL_COMPENSATE" && "\${3:-}" == *.rollback-compensate.* ]]; then exit 1; fi
exec "$REAL_NODE" "$@"
`);
    chmodSync(fakeNode, 0o755);

    const result = spawnSync('bash', [deployScript, '--rollback', releaseRunId], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        FAIL_LIVE: liveTwo,
        FAIL_COMPENSATE: liveOne,
        KERNEL_RELEASE_DEPLOY_ROOT: deployRoot,
        KERNEL_RELEASE_RUN_ID: releaseRunId,
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(fixture, 'private.json'),
        KERNEL_RELEASE_ROLLBACK_WORKER: '1',
        KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
          '66666666-6666-4666-8666-666666666666',
        KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
          '77777777-7777-4777-8777-777777777777',
        KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
        KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
        KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:
          `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
        KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
          `sha256:${createHash('sha256').update(currentManifest).digest('hex')}`,
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(79);
    expect(readlinkSync(liveOne)).toBe(values['prior-one']);
    expect(readlinkSync(liveTwo)).toBe(values['current-two']);
    const transactionDir = join(
      rollbackDir,
      'transactions/66666666-6666-4666-8666-666666666666-72-1',
    );
    expect(readFileSync(join(transactionDir, 'state.json'), 'utf8'))
      .toContain('"phase":"recovery_required"');
    expect(readFileSync(join(transactionDir, 'current.links'), 'utf8'))
      .toBe(currentManifest);

    const recovered = spawnSync('bash', [deployScript, '--rollback', releaseRunId], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        REAL_NODE: process.execPath,
        KERNEL_RELEASE_DEPLOY_ROOT: deployRoot,
        KERNEL_RELEASE_RUN_ID: releaseRunId,
        KERNEL_RELEASE_MERGE_SHA: 'b'.repeat(40),
        KERNEL_RELEASE_PRIVATE_CONFIG_FILE: join(fixture, 'private.json'),
        KERNEL_RELEASE_ROLLBACK_WORKER: '1',
        KERNEL_RELEASE_ROLLBACK_AUTHORITY_ID:
          '66666666-6666-4666-8666-666666666666',
        KERNEL_RELEASE_ROLLBACK_AUTHORIZATION:
          '77777777-7777-4777-8777-777777777777',
        KERNEL_RELEASE_ROLLBACK_CLAIM_ID: '72',
        KERNEL_RELEASE_ROLLBACK_GENERATION: '1',
        KERNEL_RELEASE_ROLLBACK_EXPECTED_DIGEST:
          `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
        KERNEL_RELEASE_ROLLBACK_EXPECTED_CURRENT_DIGEST:
          `sha256:${createHash('sha256').update(currentManifest).digest('hex')}`,
      },
      encoding: 'utf8',
    });
    expect(recovered.status, recovered.stderr).toBe(78);
    expect(readlinkSync(liveOne)).toBe(values['current-one']);
    expect(readlinkSync(liveTwo)).toBe(values['current-two']);
    expect(readFileSync(join(transactionDir, 'state.json'), 'utf8'))
      .toContain('"phase":"compensated"');
  });
});
