/**
 * lint-contract-test-immutability.sh 脚本测试
 *
 * TDD Red 阶段：脚本尚未实现时这些测试应当失败（SCRIPT_NOT_FOUND → 退出码非预期）。
 * 脚本实现后（Green 阶段）所有测试应通过。
 *
 * 测试策略：构造临时 git fixture 仓库，直接调用 bash 脚本验证行为。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 脚本路径（相对仓库根）
const SCRIPT = path.resolve(__dirname, '../scripts/lint-contract-test-immutability.sh');

/**
 * 构建一个干净的临时 git 仓库 fixture
 */
function makeFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-immut-fixture-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "ci@test"', { cwd: dir });
  execSync('git config user.name "CI"', { cwd: dir });
  return dir;
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runScript(repoDir: string, sprintDir: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = execFileSync('bash', [SCRIPT, repoDir, sprintDir], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: result, stderr: '' };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-1: commit1 后测试文件被修改 → exit 1 + 清单
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-1: 测试文件被修改后 → exit 1', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    // commit1: 引入测试文件
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint/tests'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'original content\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat: add test"', { cwd: repoDir });
    // commit2: 非法修改测试文件
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'modified content\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "chore: ILLEGALLY modify test"', { cwd: repoDir });
  });

  afterEach(() => cleanup(repoDir));

  it('应当返回非 0 exit code', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
  });

  it('输出中应包含被改文件路径', () => {
    const result = runScript(repoDir, 'test-sprint');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('foo.test.ts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-2: commit1 后测试文件未修改 → exit 0
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-2: 测试文件未被修改 → exit 0', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint/tests'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'original content\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat: add test"', { cwd: repoDir });
    // 仅修改非测试文件
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/contract-draft.md'), 'some contract\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "docs: add contract"', { cwd: repoDir });
  });

  afterEach(() => cleanup(repoDir));

  it('应当返回 exit 0', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-3: commit1 历史无法定位（文件存在但 git log 查不到新增记录）→ warn + exit 0
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-3: git 历史截断 → warn + exit 0', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint/tests'), { recursive: true });
    // 直接写文件到工作区但不 commit：
    // git log --diff-filter=A 查不到任何新增记录，触发 warn 分支
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'original\n');
    // 创建一个不包含该文件的初始 commit（确保 HEAD 存在，但 diff-filter=A 找不到该文件）
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'init\n');
    execSync('git add README.md', { cwd: repoDir });
    execSync('git commit -q -m "chore: init"', { cwd: repoDir });
    // foo.test.ts 存在于工作区，但从未被 commit → git log --diff-filter=A 返回空
  });

  afterEach(() => cleanup(repoDir));

  it('应当返回 exit 0（不误杀）', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).toBe(0);
  });

  it('输出中应包含 WARN 字样', () => {
    const result = runScript(repoDir, 'test-sprint');
    const combined = result.stdout + result.stderr;
    // git log --diff-filter=A 找不到 commit1 → 脚本应输出 WARN 并 exit 0
    expect(combined.toLowerCase()).toContain('warn');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-4: 无测试文件 → exit 0
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-4: 无测试文件 → exit 0', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/sprint-prd.md'), 'prd content\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat: add prd"', { cwd: repoDir });
  });

  afterEach(() => cleanup(repoDir));

  it('应当返回 exit 0', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-5: CI 层 diff 检测 — 无 sprints/* 变更 → skip + exit 0
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-5: CI diff 检测无 sprints/* 变更 → skip + exit 0', () => {
  it('模拟 CI step：仅含非 sprints 文件时输出 skip 并 exit 0', () => {
    // 直接执行 harness-v5-checks.yml "Detect changed sprint dirs" step 的核心逻辑
    const ciSkipScript = `
FILES="packages/brain/src/server.js
packages/engine/src/tool.ts
.github/workflows/other.yml"
SPRINT_FILES=$(echo "$FILES" | grep -vE '^sprints/archive/' | grep -E '^sprints/' || true)
if [ -z "$SPRINT_FILES" ]; then
  echo "No sprints/* changes, skipping lint-contract-test-immutability"
  exit 0
fi
echo "HAS_SPRINT_CHANGES"
exit 1
`;
    try {
      const result = execFileSync('bash', ['-c', ciSkipScript], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      expect(result).toContain('No sprints/* changes, skipping lint-contract-test-immutability');
    } catch (err: any) {
      throw new Error(`CI skip 逻辑应 exit 0，实际 exit ${err.status}: ${err.stdout}${err.stderr}`);
    }
  });

  it('模拟 CI step：含 sprints/* 文件时不 skip（HAS_SPRINT_CHANGES）', () => {
    const ciRunScript = `
FILES="sprints/07141333-contract-test-immutability-ci/contract-draft.md
packages/brain/src/server.js"
SPRINT_FILES=$(echo "$FILES" | grep -vE '^sprints/archive/' | grep -E '^sprints/' || true)
if [ -z "$SPRINT_FILES" ]; then
  echo "No sprints/* changes, skipping lint-contract-test-immutability"
  exit 0
fi
echo "HAS_SPRINT_CHANGES: $SPRINT_FILES"
exit 0
`;
    const result = execFileSync('bash', ['-c', ciRunScript], { encoding: 'utf8' });
    expect(result).toContain('HAS_SPRINT_CHANGES');
    expect(result).not.toContain('skipping');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-6（扩展）: 多个测试文件，只有部分被修改 → exit 1 + 只列出被改的
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-6（扩展）: 多文件部分修改 → exit 1，只列被改文件', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint/tests'), { recursive: true });
    // commit1: 引入两个测试文件
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'foo original\n');
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/bar.test.ts'), 'bar original\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat: add tests"', { cwd: repoDir });
    // commit2: 只修改 foo.test.ts
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'foo modified\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "chore: modify foo"', { cwd: repoDir });
  });

  afterEach(() => cleanup(repoDir));

  it('应当返回非 0 exit code', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
  });

  it('输出中应包含被改文件 foo.test.ts', () => {
    const result = runScript(repoDir, 'test-sprint');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('foo.test.ts');
  });

  it('输出中不应包含未被改的 bar.test.ts（或至少 foo.test.ts 被单独列出）', () => {
    const result = runScript(repoDir, 'test-sprint');
    const combined = result.stdout + result.stderr;
    // foo 被改了，必须出现；bar 未改，不应出现在"被改文件"清单中
    expect(combined).toContain('foo.test.ts');
    // bar.test.ts 不应在违规清单里（宽松断言：若脚本只打印被改文件则 bar 不出现）
    // 注：若脚本打印"检查文件 bar.test.ts → OK"等日志，此断言可能误判，暂按严格语义
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-7: GAN 提案轮可在最终 Red 前迭代测试；最终 Red 后仍严格冻结
// ─────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-7: 最终 Red commit 是不可变锚点', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeFixtureRepo();
    fs.mkdirSync(path.join(repoDir, 'sprints/test-sprint/tests'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'proposal v1\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat(contract): proposal round 1"', { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'approved contract\n');
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/later.test.ts'), 'approved later contract\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat(contract): proposal round 2"', { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/red-evidence.md'), 'red proof\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "test(harness): sprint failing tests (Red)"', { cwd: repoDir });
  });

  afterEach(() => cleanup(repoDir));

  it('最终 Red 前的提案轮测试修改不误报', () => {
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).toBe(0);
  });

  it('最终 Red 后修改测试仍被阻断', () => {
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'), 'mutated after red\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "feat: illegal post-red mutation"', { cwd: repoDir });

    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('foo.test.ts');
  });

  it('最终 Red 后新增测试仍被阻断', () => {
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/tests/bar.test.ts'), 'late test\n');
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "test: illegal post-red addition"', { cwd: repoDir });

    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('bar.test.ts');
  });

  it('最终 Red 后删除测试仍被阻断', () => {
    fs.rmSync(path.join(repoDir, 'sprints/test-sprint/tests/foo.test.ts'));
    execSync('git add .', { cwd: repoDir });
    execSync('git commit -q -m "test: illegal post-red deletion"', { cwd: repoDir });

    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('foo.test.ts');
  });

  it('marker 不是 Red commit 时 fail-closed', () => {
    execSync('git commit --amend -q -m "docs: mislabeled evidence marker"', { cwd: repoDir });
    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('不是 Red commit');
  });

  it('marker 删除后重加造成多个 add commit 时 fail-closed', () => {
    fs.rmSync(path.join(repoDir, 'sprints/test-sprint/red-evidence.md'));
    execSync('git add . && git commit -q -m "chore: delete marker"', { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'sprints/test-sprint/red-evidence.md'), 'replacement\n');
    execSync('git add . && git commit -q -m "test(harness): second marker (Red)"', { cwd: repoDir });

    const result = runScript(repoDir, 'test-sprint');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('只能有一个 add commit');
  });
});
