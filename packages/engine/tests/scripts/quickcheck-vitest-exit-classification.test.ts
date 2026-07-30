import {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const tempRoots: string[] = [];

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runQuickCheck(output: string, exitCode: number) {
  const root = mkdtempSync(join(tmpdir(), 'quickcheck-classification-'));
  tempRoots.push(root);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'packages/engine/node_modules/.bin'), { recursive: true });
  cpSync(join(repoRoot, 'scripts/quickcheck.sh'), join(root, 'scripts/quickcheck.sh'));

  const fakeVitest = join(root, 'packages/engine/node_modules/.bin/vitest');
  writeFileSync(
    fakeVitest,
    `#!/usr/bin/env bash\nprintf '%s' "$FAKE_VITEST_OUTPUT"\nexit ${exitCode}\n`,
  );
  chmodSync(fakeVitest, 0o755);

  const marker = join(root, 'packages/engine/marker.js');
  writeFileSync(marker, 'export const marker = 1;\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'quickcheck@example.invalid');
  git(root, 'config', 'user.name', 'QuickCheck Regression');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture base');
  writeFileSync(marker, 'export const marker = 2;\n');
  git(root, 'add', 'packages/engine/marker.js');
  git(root, 'commit', '-qm', 'fixture change');

  return spawnSync('bash', ['scripts/quickcheck.sh'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, FAKE_VITEST_OUTPUT: output },
  });
}

afterEach(() => {
  while (tempRoots.length) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe('QuickCheck Vitest exit classification', () => {
  it('fails closed for large and ANSI-decorated failure summaries', () => {
    const largeFailure = runQuickCheck(
      `\u001b[31m FAIL \u001b[0m behavior\n${'x'.repeat(96_000)}\nTests 1 failed | 10 passed\n`,
      1,
    );
    expect(largeFailure.status, largeFailure.stdout + largeFailure.stderr).toBe(1);
  });

  it('fails closed for an unknown non-zero runner exit', () => {
    const unknownFailure = runQuickCheck('runner exited unexpectedly\n', 7);
    expect(unknownFailure.status, unknownFailure.stdout + unknownFailure.stderr).toBe(1);
  });

  it('degrades only for a worker OOM with pass summary and no fail summary', () => {
    const genuineOom = runQuickCheck(
      'Worker terminated: JavaScript heap out of memory\nTests 12 passed\n',
      1,
    );
    expect(genuineOom.status, genuineOom.stdout + genuineOom.stderr).toBe(0);

    const oomWithFailure = runQuickCheck(
      'Worker terminated: JavaScript heap out of memory\nTests 1 failed | 11 passed\n',
      1,
    );
    expect(oomWithFailure.status, oomWithFailure.stdout + oomWithFailure.stderr).toBe(1);
  });
});
