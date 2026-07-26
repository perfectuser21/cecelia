import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(
  __dirname,
  '../../scripts/devgate/check-tdd-commit-order.sh',
);
const fixtures: string[] = [];

function createFixture(redEvidencePath: string) {
  const repo = mkdtempSync(join(tmpdir(), 'tdd-red-evidence-'));
  fixtures.push(repo);
  execSync('git init -q', { cwd: repo });
  execSync('git config user.email "ci@test"', { cwd: repo });
  execSync('git config user.name "CI"', { cwd: repo });

  writeFileSync(join(repo, 'README.md'), 'base\n');
  execSync('git add . && git commit -q -m "chore: base"', { cwd: repo });
  execSync('git branch base', { cwd: repo });

  mkdirSync(join(repo, 'sprints/test-sprint/tests'), { recursive: true });
  writeFileSync(
    join(repo, 'sprints/test-sprint/tests/example.test.ts'),
    'it("proposal v1", () => {});\n',
  );
  execSync('git add . && git commit -q -m "feat(contract): proposal round 1"', {
    cwd: repo,
  });
  writeFileSync(
    join(repo, 'sprints/test-sprint/tests/example.test.ts'),
    'it("approved contract", () => {});\n',
  );
  execSync('git add . && git commit -q -m "feat(contract): proposal round 2"', {
    cwd: repo,
  });

  const evidence = join(repo, redEvidencePath);
  mkdirSync(resolve(evidence, '..'), { recursive: true });
  writeFileSync(evidence, 'structured red evidence\n');
  execSync('git add . && git commit -q -m "test(harness): sprint failing tests (Red)"', {
    cwd: repo,
  });

  mkdirSync(join(repo, 'packages/example'), { recursive: true });
  writeFileSync(join(repo, 'packages/example/index.js'), 'export const ok = true;\n');
  execSync('git add . && git commit -q -m "feat(example): implementation (Green)"', {
    cwd: repo,
  });
  return repo;
}

function run(repo: string) {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, BASE_REF: 'base', HEAD_REF: 'HEAD' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (error: any) {
    return {
      exitCode: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

afterEach(() => {
  while (fixtures.length) rmSync(fixtures.pop()!, { recursive: true, force: true });
});

describe('check-tdd-commit-order Red evidence allowlist', () => {
  it('允许 Red commit 携带同 sprint 的 red-evidence.md', () => {
    const result = run(createFixture('sprints/test-sprint/red-evidence.md'));
    expect(result.exitCode, result.output).toBe(0);
  });

  it('不允许 Red commit 用任意 markdown 冒充红证据', () => {
    const result = run(createFixture('sprints/test-sprint/notes.md'));
    expect(result.exitCode, result.output).not.toBe(0);
    expect(result.output).toContain('notes.md');
  });

  it('不允许 Red commit 携带实现代码', () => {
    const result = run(createFixture('packages/illegal.js'));
    expect(result.exitCode, result.output).not.toBe(0);
    expect(result.output).toContain('packages/illegal.js');
  });

  it('Red 后修改再还原测试仍按历史触碰阻断', () => {
    const repo = createFixture('sprints/test-sprint/red-evidence.md');
    const testPath = join(repo, 'sprints/test-sprint/tests/example.test.ts');
    writeFileSync(testPath, 'it("illegal mutation", () => {});\n');
    execSync('git add . && git commit -q -m "chore: mutate frozen test"', { cwd: repo });
    execSync('git checkout HEAD~1 -- sprints/test-sprint/tests/example.test.ts', { cwd: repo });
    execSync('git add . && git commit -q -m "chore: restore frozen test"', { cwd: repo });

    const result = run(repo);
    expect(result.exitCode, result.output).not.toBe(0);
    expect(result.output).toContain('修改了测试文件');
  });
});
