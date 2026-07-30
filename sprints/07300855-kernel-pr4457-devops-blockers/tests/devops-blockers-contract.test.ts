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

const repoRoot = resolve(import.meta.dirname, '../../..');
const tempRoots: string[] = [];

function run(command: string, args: string[], options: Record<string, unknown> = {}) {
  const { env: extraEnv = {}, ...spawnOptions } = options;
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 240_000,
    env: { ...process.env, ...(extraEnv as object) },
    ...spawnOptions,
  });
}

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function makeQuickCheckFixture(output: string, exitCode: number) {
  const root = mkdtempSync(join(tmpdir(), 'quickcheck-contract-'));
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
  writeFileSync(join(root, 'packages/engine/marker.js'), 'export const marker = 1;\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'contract@example.invalid');
  git(root, 'config', 'user.name', 'Contract Red');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture base');
  writeFileSync(join(root, 'packages/engine/marker.js'), 'export const marker = 2;\n');
  git(root, 'add', 'packages/engine/marker.js');
  git(root, 'commit', '-qm', 'fixture change');
  return run('bash', ['scripts/quickcheck.sh'], {
    cwd: root,
    env: { FAKE_VITEST_OUTPUT: output },
  });
}

afterEach(() => {
  while (tempRoots.length) rmSync(tempRoots.pop()!, { recursive: true, force: true });
});

describe('Draft PR #4457 DevOps blocker 行为级 Red', () => {
  it('QuickCheck 大输出真实失败与未知非零均 fail-closed，仅三条件 OOM 降级', () => {
    const largeFailure = makeQuickCheckFixture(
      ` FAIL  one behavioral failure\n${'x'.repeat(256_000)}\nTests 1 failed | 10 passed\n`,
      1,
    );
    expect(largeFailure.status, largeFailure.stdout + largeFailure.stderr).not.toBe(0);

    const unknownFailure = makeQuickCheckFixture('runner exited unexpectedly\n', 7);
    expect(unknownFailure.status, unknownFailure.stdout + unknownFailure.stderr).toBe(1);

    const genuineOom = makeQuickCheckFixture(
      'Worker terminated: JavaScript heap out of memory\nTests 12 passed\n',
      1,
    );
    expect(genuineOom.status, genuineOom.stdout + genuineOom.stderr).toBe(0);
  });

  it('mutation seam 仅由 test:node 收集且 Vitest collection 排除', () => {
    const direct = run('node', [
      '--test',
      'packages/brain/scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs',
    ]);
    expect(direct.status, direct.stdout + direct.stderr).toBe(0);

    const nativeRegistered = run('npm', ['run', 'test:node', '--workspace', 'packages/brain']);
    expect(nativeRegistered.stdout).toContain(
      'branch protection normal uses broker and server-owned evidence',
    );

    const vitestCollection = run(
      'npm',
      [
        'exec',
        '--workspace',
        'packages/brain',
        '--',
        'vitest',
        'list',
        'scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs',
      ],
    );
    expect(vitestCollection.status, vitestCollection.stdout + vitestCollection.stderr).toBe(0);
    expect(vitestCollection.stdout).not.toContain(
      'github-mutation-equivalence-seam.test.cjs',
    );
  });

  it('OKR integration 在进程内 Router 上执行且不因外部 Brain 缺失而跳过', () => {
    const result = run(
      'npm',
      [
        'exec',
        '--workspace',
        'packages/brain',
        '--',
        'vitest',
        'run',
        'src/__tests__/integration/okr-decomposition-flow.integration.test.js',
        '--config',
        'vitest.integration.config.js',
        '--reporter=json',
      ],
      {
        env: {
          NODE_ENV: 'test',
          DB_NAME: 'cecelia_test',
          TEST_DATABASE_URL:
            process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/cecelia_test',
          BRAIN_URL: 'http://127.0.0.1:1',
        },
      },
    );
    const report = JSON.parse(result.stdout || '{}');
    const assertions = report.testResults?.flatMap(
      (suite: { assertionResults?: Array<{ status: string }> }) => suite.assertionResults ?? [],
    ) ?? [];
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(assertions.length, '必须实际收集 OKR 行为用例').toBeGreaterThan(0);
    expect(
      assertions.every((entry: { status: string }) => entry.status === 'passed'),
      '外部 Brain 不可达时不得整套 pending；真实 Express/Supertest + cecelia_test 必须执行',
    ).toBe(true);
  });

  it('historical migration fixture 真跑 canonical runner 时只应用 369-381', () => {
    const result = run(
      'npm',
      [
        'exec',
        '--workspace',
        'packages/brain',
        '--',
        'vitest',
        'run',
        'src/__tests__/integration/kernel-release-runs.integration.test.js',
        '-t',
        'uses the canonical runner to upgrade an N-1 schema from 368 through 381',
        '--config',
        'vitest.integration.config.js',
        '--reporter=verbose',
      ],
      {
        env: {
          NODE_ENV: 'test',
          DB_NAME: 'cecelia_test',
          TEST_DATABASE_URL:
            process.env.TEST_DATABASE_URL ?? 'postgresql://localhost/cecelia_test',
        },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain(
      'uses the canonical runner to upgrade an N-1 schema from 368 through 381',
    );
  });
});
