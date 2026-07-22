import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const REAL_SCRIPT = join(process.cwd(), '..', '..', 'scripts', 'quickcheck.sh');

type ScenarioPackage = {
  packagePath: 'packages/engine' | 'packages/brain' | 'apps/api' | 'apps/dashboard';
  exitCode: number;
  output: string;
};

describe('quickcheck.sh — worker OOM 与失败计数优先级', () => {
  let fakeRepo: string;

  beforeEach(() => {
    fakeRepo = mkdtempSync(join(tmpdir(), 'quickcheck-oom-priority-'));
    execSync(`git init -q "${fakeRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" config user.name test`, { stdio: 'pipe' });

    mkdirSync(join(fakeRepo, 'packages', 'engine'), { recursive: true });
    mkdirSync(join(fakeRepo, 'packages', 'brain'), { recursive: true });
    mkdirSync(join(fakeRepo, 'apps', 'api'), { recursive: true });
    mkdirSync(join(fakeRepo, 'apps', 'dashboard'), { recursive: true });
    mkdirSync(join(fakeRepo, 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(fakeRepo, '.quickcheck-fixtures'), { recursive: true });

    writeFileSync(join(fakeRepo, 'packages', 'engine', 'package.json'), '{"name":"engine"}\n');
    writeFileSync(join(fakeRepo, 'packages', 'brain', 'package.json'), '{"name":"brain"}\n');
    writeFileSync(join(fakeRepo, 'apps', 'api', 'package.json'), '{"name":"api"}\n');
    writeFileSync(join(fakeRepo, 'apps', 'dashboard', 'package.json'), '{"name":"dashboard"}\n');
    writeFileSync(join(fakeRepo, 'quickcheck.sh'), readFileSync(REAL_SCRIPT, 'utf8'));
    chmodSync(join(fakeRepo, 'quickcheck.sh'), 0o755);

    writeFileSync(
      join(fakeRepo, 'node_modules', '.bin', 'vitest'),
      `#!/usr/bin/env bash
set -uo pipefail
repo_root="$(git rev-parse --show-toplevel)"
rel_path="\${PWD#"$repo_root"/}"
fixture_key="\${rel_path//\\//__}"
cat "$repo_root/.quickcheck-fixtures/$fixture_key.out"
exit "$(cat "$repo_root/.quickcheck-fixtures/$fixture_key.exit")"
`,
    );
    chmodSync(join(fakeRepo, 'node_modules', '.bin', 'vitest'), 0o755);

    execSync(`git -C "${fakeRepo}" add .`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" commit -qm init`, { stdio: 'pipe' });
    const mainSha = execSync(`git -C "${fakeRepo}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
    execSync(`git -C "${fakeRepo}" update-ref refs/remotes/origin/main ${mainSha}`, { stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(fakeRepo, { recursive: true, force: true });
  });

  it('失败计数与 worker OOM 文案同现时，quickcheck 整体退出码非 0', () => {
    const result = runQuickcheck([
      {
        packagePath: 'packages/engine',
        exitCode: 1,
        output: [
          'Vitest caught 1 unhandled error during the test run.',
          'Error: Worker exited unexpectedly',
          'Test Files  1 failed | 4 passed (5)',
          'Tests  1 failed | 24 passed (25)',
        ].join('\n'),
      },
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/❌ 失败/);
  });

  it('仅 worker OOM、无任何失败计数时，quickcheck 整体退出码保持 0', () => {
    const result = runQuickcheck([
      {
        packagePath: 'packages/engine',
        exitCode: 1,
        output: [
          'Vitest caught 1 unhandled error during the test run.',
          'Error: Worker exited unexpectedly',
          'Test Files  4 passed (4)',
          'Tests  42 passed (42)',
        ].join('\n'),
      },
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/Worker 异常退出/);
  });

  it('正常全部 PASS 时，quickcheck 整体退出码保持 0', () => {
    const result = runQuickcheck([
      {
        packagePath: 'packages/engine',
        exitCode: 0,
        output: [
          ' RUN  v3.2.4 /tmp/fake-repo/packages/engine',
          ' ✓ tests/scripts/example.test.ts (4 tests) 12ms',
          'Test Files  1 passed (1)',
          'Tests  4 passed (4)',
        ].join('\n'),
      },
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/✅ 通过/);
  });

  it('多包混合场景时，整体结果以失败为准', () => {
    const result = runQuickcheck([
      {
        packagePath: 'packages/engine',
        exitCode: 1,
        output: [
          'Vitest caught 1 unhandled error during the test run.',
          'Error: Worker exited unexpectedly',
          'Test Files  4 passed (4)',
          'Tests  42 passed (42)',
        ].join('\n'),
      },
      {
        packagePath: 'apps/dashboard',
        exitCode: 1,
        output: [
          'Vitest caught 1 unhandled error during the test run.',
          'Error: Worker exited unexpectedly',
          'Test Files  1 failed | 4 passed (5)',
          'Tests  1 failed | 24 passed (25)',
        ].join('\n'),
      },
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/apps\/dashboard[\s\S]*❌ 失败/);
  });

  function runQuickcheck(packages: ScenarioPackage[]) {
    for (const scenario of packages) {
      const targetFile = join(fakeRepo, scenario.packagePath, 'fixture.txt');
      writeFileSync(targetFile, `scenario for ${scenario.packagePath}\n`);

      const fixtureKey = scenario.packagePath.replaceAll('/', '__');
      writeFileSync(join(fakeRepo, '.quickcheck-fixtures', `${fixtureKey}.out`), `${scenario.output}\n`);
      writeFileSync(join(fakeRepo, '.quickcheck-fixtures', `${fixtureKey}.exit`), `${scenario.exitCode}\n`);
    }

    execSync(`git -C "${fakeRepo}" add packages apps .quickcheck-fixtures`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" commit -qm scenario`, { stdio: 'pipe' });

    try {
      const output = execFileSync('bash', ['quickcheck.sh'], {
        cwd: fakeRepo,
        encoding: 'utf8',
      });
      return { status: 0, output };
    } catch (error: any) {
      return {
        status: error.status ?? 1,
        output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
      };
    }
  }
});
