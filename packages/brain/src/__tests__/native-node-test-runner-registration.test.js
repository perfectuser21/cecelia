import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import brainConfig from '../../vitest.config.js';

const brainRoot = resolve(import.meta.dirname, '../..');
const seamPath =
  'scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs';

function run(command, args) {
  return spawnSync(command, args, {
    cwd: brainRoot,
    encoding: 'utf8',
    timeout: 120_000,
  });
}

describe('native node:test runner registration', () => {
  it('excludes the mutation seam from Vitest and registers it in test:node', async () => {
    expect(brainConfig.test.exclude).toContain(seamPath);

    const packageJson = JSON.parse(
      await readFile(resolve(brainRoot, 'package.json'), 'utf8'),
    );
    expect(packageJson.scripts['test:node'].split(/\s+/)).toContain(seamPath);

    const vitestResult = run(resolve(brainRoot, '../../node_modules/.bin/vitest'), [
      'run',
      seamPath,
      '--passWithNoTests',
    ]);
    expect(
      vitestResult.status,
      vitestResult.stdout + vitestResult.stderr,
    ).toBe(0);
    expect(vitestResult.stdout + vitestResult.stderr).toContain(
      'No test files found',
    );

    const nativeResult = run('node', ['--test', seamPath]);
    expect(
      nativeResult.status,
      nativeResult.stdout + nativeResult.stderr,
    ).toBe(0);
    expect(nativeResult.stdout).toContain(
      'branch protection normal uses broker and server-owned evidence',
    );
  });
});
