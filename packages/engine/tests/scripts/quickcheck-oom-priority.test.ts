import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// quickcheck.sh 真实路径（相对工作目录 packages/engine）
const REAL_SCRIPT = join(process.cwd(), '..', '..', 'scripts', 'quickcheck.sh');

// vitest 输出 fixture：失败计数 + worker OOM 文案同现，但不含逐文件 " FAIL " 标记
// （模拟 worker 崩溃导致逐文件 FAIL 标记未及打印，仅汇总行留下失败计数的真实场景）
const FIXTURE_FAIL_AND_OOM = `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
Worker unexpectedly exited
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 24 passed (25)
   Duration  8.42s`;

// vitest 输出 fixture：worker OOM 崩溃但真的零失败（预存在环境问题，应继续宽免）
const FIXTURE_OOM_ONLY = `Worker unexpectedly exited
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
 Test Files  3 passed (3)
      Tests  42 passed (42)
   Duration  6.10s`;

// vitest 输出 fixture：正常全部 PASS，无 OOM 无失败
const FIXTURE_NORMAL_PASS = ` Test Files  3 passed (3)
      Tests  42 passed (42)
   Duration  3.55s`;

/**
 * 构造一个独立 git 仓库，复制真实 quickcheck.sh，并为每个指定的包目录
 * 放置一个假 vitest 二进制：读取包目录下的 fixture 文件输出预设内容与退出码。
 * 这样测的是 quickcheck.sh 真实的分类逻辑本身，只对"vitest 子进程"这一外部
 * 工具边界做替身（真实触发 Node worker OOM 崩溃在 CI 中不可确定性复现）。
 */
function setupFakeRepo(pkgFixtures: Record<string, { output: string; exitCode: number }>) {
  const fakeRepo = mkdtempSync(join(tmpdir(), 'qcoom-'));
  execSync(`git init -q "${fakeRepo}"`, { stdio: 'pipe' });
  execSync(`git -C "${fakeRepo}" config user.email test@test.com`, { stdio: 'pipe' });
  execSync(`git -C "${fakeRepo}" config user.name test`, { stdio: 'pipe' });
  execSync(`git -C "${fakeRepo}" commit --allow-empty -qm base`, { stdio: 'pipe' });

  // 假 vitest 二进制：读取 cwd 下的 fixture 文件
  const nmBin = join(fakeRepo, 'node_modules', '.bin');
  mkdirSync(nmBin, { recursive: true });
  const fakeVitest = join(nmBin, 'vitest');
  writeFileSync(
    fakeVitest,
    '#!/bin/bash\n' +
      'DIR="$(pwd)"\n' +
      'if [[ -f "$DIR/.qc-fixture-out" ]]; then\n' +
      '  cat "$DIR/.qc-fixture-out"\n' +
      '  exit "$(cat "$DIR/.qc-fixture-exit")"\n' +
      'else\n' +
      '  echo "no fixture configured for $DIR" >&2\n' +
      '  exit 1\n' +
      'fi\n'
  );
  chmodSync(fakeVitest, 0o755);

  // 逐包写入变更文件 + fixture
  for (const [pkg, fixture] of Object.entries(pkgFixtures)) {
    const pkgDir = join(fakeRepo, pkg);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'dummy-change.js'), '// changed\n');
    writeFileSync(join(pkgDir, '.qc-fixture-out'), fixture.output + '\n');
    writeFileSync(join(pkgDir, '.qc-fixture-exit'), String(fixture.exitCode));
  }
  execSync(`git -C "${fakeRepo}" add -A && git -C "${fakeRepo}" commit -qm changes`, { stdio: 'pipe' });

  // 复制真实 quickcheck.sh
  const scriptContent = readFileSync(REAL_SCRIPT, 'utf8');
  const fakeScript = join(fakeRepo, 'quickcheck.sh');
  writeFileSync(fakeScript, scriptContent);
  chmodSync(fakeScript, 0o755);

  return { fakeRepo, fakeScript };
}

function runQuickcheck(fakeRepo: string, fakeScript: string): { exitCode: number; output: string } {
  try {
    const output = execSync(`bash "${fakeScript}" 2>&1`, {
      cwd: fakeRepo,
      encoding: 'utf8',
      timeout: 15000,
    });
    return { exitCode: 0, output };
  } catch (e: any) {
    return { exitCode: e.status ?? 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

describe('quickcheck.sh — [BEHAVIOR] OOM 宽免优先级修复', () => {
  it('[BEHAVIOR] 失败计数与 worker OOM 文案同现时，quickcheck 整体退出码非 0', () => {
    const { fakeRepo, fakeScript } = setupFakeRepo({
      'packages/engine': { output: FIXTURE_FAIL_AND_OOM, exitCode: 1 },
    });
    try {
      const { exitCode } = runQuickcheck(fakeRepo, fakeScript);
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  }, 20000);

  it('[BEHAVIOR] 仅 worker OOM、无任何失败计数时，quickcheck 整体退出码保持 0（宽免不误伤）', () => {
    const { fakeRepo, fakeScript } = setupFakeRepo({
      'packages/engine': { output: FIXTURE_OOM_ONLY, exitCode: 1 },
    });
    try {
      const { exitCode } = runQuickcheck(fakeRepo, fakeScript);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  }, 20000);

  it('[BEHAVIOR] 正常全部 PASS 时，quickcheck 整体退出码保持 0（不引入新误报）', () => {
    const { fakeRepo, fakeScript } = setupFakeRepo({
      'packages/engine': { output: FIXTURE_NORMAL_PASS, exitCode: 0 },
    });
    try {
      const { exitCode } = runQuickcheck(fakeRepo, fakeScript);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  }, 20000);

  it('[BEHAVIOR] 多包混合场景：一个包仅 OOM、另一个包失败+OOM 同现，整体结果以失败为准（顺序无关）', () => {
    const { fakeRepo, fakeScript } = setupFakeRepo({
      'packages/engine': { output: FIXTURE_OOM_ONLY, exitCode: 1 },
      'apps/dashboard': { output: FIXTURE_FAIL_AND_OOM, exitCode: 1 },
    });
    try {
      const { exitCode } = runQuickcheck(fakeRepo, fakeScript);
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(fakeRepo, { recursive: true, force: true });
    }
  }, 20000);
});
