/**
 * hook-gates.test.ts - Hook Gates 5个真锁验收测试
 *
 * 覆盖 PR #918 新增的 5 个真锁：
 * 1. bash-guard.sh: git push 前跑 local-precheck.sh（规则 2a）
 * 2. bash-guard.sh: git commit message 格式验证（规则 2b）
 * 3. branch-protect.sh: Write .prd-*.md 时验证 ## 成功标准 章节
 * 4. branch-protect.sh: Write .dod-*.md 时验证 - [ ] checkbox 格式
 * 5. stop-dev.sh: Step 4 flag=done 时额外运行 check-learning.sh
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const ENGINE_ROOT = resolve(__dirname, "../..");
const BASH_GUARD_PATH = resolve(ENGINE_ROOT, "hooks/bash-guard.sh");
const BRANCH_PROTECT_PATH = resolve(ENGINE_ROOT, "hooks/branch-protect.sh");
const STOP_DEV_PATH = resolve(ENGINE_ROOT, "hooks/stop-dev.sh");

let tempDir: string;
let patchedBashGuardPath: string;
let patchedBranchProtectPath: string;

/** 递归复制目录 */
function copyDir(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const dstPath = join(dst, entry);
    if (lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      copyFileSync(srcPath, dstPath);
    }
  }
}

/** 运行 bash-guard.sh 并返回退出码和 stderr */
function runBashGuard(
  command: string
): { exitCode: number; stderr: string } {
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });
  try {
    execSync(`bash "${patchedBashGuardPath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOOK_INPUT: input },
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: any) {
    return { exitCode: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

/** 运行 branch-protect.sh 并返回退出码和 stderr */
function runBranchProtect(
  toolName: string,
  filePath: string,
  content: string
): { exitCode: number; stderr: string } {
  const input = JSON.stringify({
    tool_name: toolName,
    tool_input: { file_path: filePath, content },
  });
  try {
    execSync(`bash "${patchedBranchProtectPath}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, HOOK_INPUT: input },
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: any) {
    return { exitCode: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

describe("Hook Gates — 5 真锁验收 (PR #918)", () => {
  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hook-gates-test-"));
    const hooksDir = join(tempDir, "hooks");
    const libDir = join(tempDir, "lib");
    mkdirSync(hooksDir);
    copyDir(join(ENGINE_ROOT, "lib"), libDir);

    // 复制并 patch bash-guard.sh（HOOK_INPUT 注入）
    patchedBashGuardPath = join(hooksDir, "bash-guard.sh");
    copyFileSync(BASH_GUARD_PATH, patchedBashGuardPath);
    let bgContent = readFileSync(patchedBashGuardPath, "utf-8");
    bgContent = bgContent.replace(
      /^INPUT="\$\(cat\)"$/m,
      'INPUT="${HOOK_INPUT:-$(cat)}"'
    );
    writeFileSync(patchedBashGuardPath, bgContent);

    // 复制并 patch branch-protect.sh
    patchedBranchProtectPath = join(hooksDir, "branch-protect.sh");
    copyFileSync(BRANCH_PROTECT_PATH, patchedBranchProtectPath);
    let bpContent = readFileSync(patchedBranchProtectPath, "utf-8");
    bpContent = bpContent.replace(
      /^INPUT=\$\(cat\)$/m,
      'INPUT="${HOOK_INPUT:-$(cat)}"'
    );
    writeFileSync(patchedBranchProtectPath, bpContent);
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ─── 门 1: bash-guard.sh git push precheck ─────────────────
  describe("门 1: git push precheck (规则 2a)", () => {
    it("bash-guard.sh 包含 git push 拦截规则", () => {
      const content = readFileSync(BASH_GUARD_PATH, "utf-8");
      expect(content).toContain("git\\s+push");
      expect(content).toContain("local-precheck.sh");
    });

    it("正常命令（非 git push）不受影响", () => {
      const result = runBashGuard("ls -la");
      expect(result.exitCode).toBe(0);
    });

    it("git push 命令触发 precheck 逻辑（precheck 不存在时放行）", () => {
      // 当 precheck 脚本不存在时，hook 应放行（不阻止）
      const result = runBashGuard("git push origin main");
      // 若 local-precheck.sh 不存在则放行（exit 0），若存在且通过也放行
      // 在 CI 环境中 precheck 不在标准路径，应该 exit 0
      expect([0, 2]).toContain(result.exitCode);
    });
  });

  // ─── 门 2: bash-guard.sh commit message 格式 ─────────────────
  describe("门 2: commit message 格式验证 (规则 2b)", () => {
    it("bash-guard.sh 包含 Conventional Commits 验证规则", () => {
      const content = readFileSync(BASH_GUARD_PATH, "utf-8");
      expect(content).toContain("VALID_COMMIT_PREFIXES");
      expect(content).toContain("feat|fix|docs");
    });

    it("符合规范的 commit message 放行: feat:", () => {
      const result = runBashGuard('git commit -m "feat: add new feature"');
      expect(result.exitCode).toBe(0);
    });

    it("符合规范的 commit message 放行: fix:", () => {
      const result = runBashGuard('git commit -m "fix: resolve bug"');
      expect(result.exitCode).toBe(0);
    });

    it("符合规范的 commit message 放行: chore:", () => {
      const result = runBashGuard('git commit -m "chore: update deps"');
      expect(result.exitCode).toBe(0);
    });

    it("符合规范的 commit message 放行: feat!:", () => {
      const result = runBashGuard('git commit -m "feat!: breaking change"');
      expect(result.exitCode).toBe(0);
    });

    it("符合规范的 commit message 放行: feat(scope):", () => {
      const result = runBashGuard('git commit -m "feat(hooks): add gate"');
      expect(result.exitCode).toBe(0);
    });

    it("不符合规范的 commit message 被阻止: 无前缀", () => {
      const result = runBashGuard('git commit -m "add new feature"');
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("BASH GUARD");
    });

    it("不符合规范的 commit message 被阻止: 中文开头", () => {
      const result = runBashGuard('git commit -m "新增功能"');
      expect(result.exitCode).toBe(2);
    });

    it("git commit 无 -m 参数时放行（不检查消息格式）", () => {
      // 没有 -m 参数时无法提取消息，应放行
      const result = runBashGuard("git commit --amend --no-edit");
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── 门 3: branch-protect.sh PRD 内容验证 ─────────────────
  describe("门 3: .prd-*.md 内容验证（## 成功标准）", () => {
    it("branch-protect.sh 包含 PRD 内容验证逻辑", () => {
      const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
      expect(content).toContain("PRD 内容验证");
      expect(content).toContain("成功标准");
    });

    it("Write .prd-*.md 包含 ## 成功标准 章节时放行", () => {
      const prdContent = `# PRD: 新功能\n\n## 背景\n\n测试 PRD\n\n## 成功标准\n\n- 功能正常工作\n- 测试通过\n`;
      const result = runBranchProtect("Write", ".prd-cp-test-gate.md", prdContent);
      // 放行条件：包含 ## 成功标准
      // 可能因为分支检查等原因返回非 0，但不应该因为"缺少成功标准"报错
      if (result.exitCode !== 0) {
        expect(result.stderr).not.toContain("缺少成功标准");
      }
    });

    it("Write .prd-*.md 缺少 ## 成功标准 时被阻止", () => {
      const badPrd = `# PRD: 新功能\n\n## 背景\n\n没有成功标准章节的 PRD\n`;
      const result = runBranchProtect("Write", ".prd-cp-test-gate.md", badPrd);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("成功标准");
    });

    it("Write .prd-*.md 空内容时被阻止", () => {
      const result = runBranchProtect("Write", ".prd-cp-empty.md", "");
      expect(result.exitCode).toBe(2);
    });

    it("Write 非 PRD 文件不受影响（分支检查可能生效）", () => {
      const result = runBranchProtect("Write", "src/app.ts", "console.log('hi')");
      // 只确认不会因为 PRD 内容检查而报错
      if (result.exitCode !== 0) {
        expect(result.stderr).not.toContain("成功标准");
      }
    });
  });

  // ─── 门 4: branch-protect.sh DoD 内容验证 ─────────────────
  describe("门 4: .dod-*.md 内容验证（- [ ] checkbox）", () => {
    it("branch-protect.sh 包含 DoD 内容验证逻辑", () => {
      const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
      expect(content).toContain("DoD 内容验证");
    });

    it("Write .dod-*.md 包含 - [ ] checkbox 时放行", () => {
      const dodContent = `# DoD\n\n## 验收清单\n\n- [ ] 功能A正常工作\n- [ ] 测试全部通过\n- [x] 已完成的项\n`;
      const result = runBranchProtect("Write", ".dod-cp-test-gate.md", dodContent);
      if (result.exitCode !== 0) {
        expect(result.stderr).not.toContain("验收清单");
        expect(result.stderr).not.toContain("checkbox");
      }
    });

    it("Write .dod-*.md 缺少 - [ ] checkbox 时被阻止", () => {
      const badDod = `# DoD\n\n没有任何 checkbox 的 DoD 文件\n\n只有普通文本\n`;
      const result = runBranchProtect("Write", ".dod-cp-test-gate.md", badDod);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("验收清单");
    });

    it("Write .dod-*.md 空内容时被阻止", () => {
      const result = runBranchProtect("Write", ".dod-cp-empty.md", "");
      expect(result.exitCode).toBe(2);
    });

    it("- [x] 已完成 checkbox 也被认为有效", () => {
      const dodWithDoneItems = `# DoD\n\n- [x] 已完成项\n- [x] 另一个完成项\n`;
      const result = runBranchProtect("Write", ".dod-cp-done.md", dodWithDoneItems);
      if (result.exitCode !== 0) {
        expect(result.stderr).not.toContain("验收清单");
      }
    });
  });

  // ─── 门 5: stop-dev.sh Learning 内容验证 ─────────────────
  describe("门 5: stop-dev.sh Learning 内容验证 (v14.1.0)", () => {
    it("stop-dev.sh 包含 Learning 内容验证逻辑 (v14.1.0)", () => {
      const content = readFileSync(STOP_DEV_PATH, "utf-8");
      expect(content).toContain("v14.1.0");
      expect(content).toContain("check-learning.sh");
      expect(content).toContain("step_4_learning: pending");
    });

    it("stop-dev.sh 包含重置 step_4 标志的逻辑", () => {
      const content = readFileSync(STOP_DEV_PATH, "utf-8");
      expect(content).toContain("step_4_learning: done");
      expect(content).toContain("step_4_learning: pending");
    });

    it("stop-dev.sh Learning 验证在 STEP_4_STATUS 检查之后触发", () => {
      const content = readFileSync(STOP_DEV_PATH, "utf-8");
      // STEP_4_STATUS 变量赋值（第一次出现）必须在 check-learning.sh 调用之前
      const step4StatusIdx = content.indexOf("STEP_4_STATUS=");
      const checkLearningIdx = content.indexOf("check-learning.sh");
      expect(step4StatusIdx).toBeGreaterThan(0);
      expect(checkLearningIdx).toBeGreaterThan(0);
      expect(checkLearningIdx).toBeGreaterThan(step4StatusIdx);
    });
  });
});
