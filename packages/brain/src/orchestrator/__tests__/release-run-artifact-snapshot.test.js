import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareReleaseArtifactSnapshot } from '../../../../../scripts/lib/release-run-artifact-snapshot.mjs';

const temporaryRoots = [];

function makeWritable(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) makeWritable(join(path, entry));
  } else if (!stat.isSymbolicLink()) {
    chmodSync(path, 0o600);
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    makeWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ReleaseRun immutable artifact snapshots', () => {
  it('materializes and reuses only the exact authorized merge archive', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'release-snapshot-fixture-'));
    temporaryRoots.push(fixture);
    mkdirSync(join(fixture, 'packages/workflows/skills/example'), { recursive: true });
    writeFileSync(
      join(fixture, 'packages/workflows/skills/example/SKILL.md'),
      '# exact skill\n',
    );
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fixture });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: fixture });
    execFileSync('git', ['add', '.'], { cwd: fixture });
    execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: fixture });
    const mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: fixture,
      encoding: 'utf8',
    }).trim();
    const artifactStore = resolve(fixture, '.artifacts');

    const first = prepareReleaseArtifactSnapshot({
      repoRoot: fixture,
      artifactStore,
      mergeSha,
    });
    const second = prepareReleaseArtifactSnapshot({
      repoRoot: fixture,
      artifactStore,
      mergeSha,
    });

    expect(second).toBe(first);
    expect(JSON.parse(readFileSync(join(first, '.release-snapshot.json'), 'utf8')))
      .toEqual({
        schema_version: 1,
        merge_sha: mergeSha,
        source: 'git-archive',
      });
    expect(readFileSync(
      join(first, 'packages/workflows/skills/example/SKILL.md'),
      'utf8',
    )).toBe('# exact skill\n');
    expect(statSync(
      join(first, 'packages/workflows/skills/example/SKILL.md'),
    ).mode & 0o222).toBe(0);
  });
});
