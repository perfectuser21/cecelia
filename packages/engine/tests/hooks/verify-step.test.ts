/**
 * verify-step.sh 测试
 *
 * 验证 State Machine 强制层三个步骤的验证逻辑：
 * - step1: Task Card DoD Test 字段无假命令
 * - step2: 代码已写，有实现文件改动
 * - step4: Learning 文件有必需章节
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const ORIG_HOOK_PATH = resolve(__dirname, "../../hooks/verify-step.sh");

let tempDir: string;

function runVerifyStep(
  step: string,
  branch: string,
  projectRoot: string,
  cwd?: string,
): { exitCode: number; stderr: string } {
  try {
    execSync(`bash "${ORIG_HOOK_PATH}" "${step}" "${branch}" "${projectRoot}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd ?? projectRoot,
    });
    return { exitCode: 0, stderr: "" };
  } catch (err: any) {
    return { exitCode: err.status ?? 1, stderr: err.stderr || "" };
  }
}

/** 创建含 DoD Test 字段的 Task Card */
function createTaskCard(projectRoot: string, branch: string, testLines: string[]): void {
  const content = `---
id: task-${branch}
type: task-card
---

# Task Card: 测试用

## 验收条件（DoD）

${testLines.map((t, i) => `- [x] 条目 ${i + 1}\n  ${t}`).join("\n\n")}
`;
  writeFileSync(join(projectRoot, `.task-${branch}.md`), content, "utf-8");
}

/** 创建 Learning 文件 */
function createLearning(projectRoot: string, branch: string, sections: string[]): void {
  const learningDir = join(projectRoot, "docs", "learnings");
  mkdirSync(learningDir, { recursive: true });
  const content = sections.join("\n\n") + "\n";
  writeFileSync(join(learningDir, `${branch}.md`), content, "utf-8");
}

/** 初始化含提交的临时 git 仓库 */
function initGitRepo(dir: string, branch: string): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  execSync("git checkout -b main", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
  // 创建功能分支
  execSync(`git checkout -b ${branch}`, { cwd: dir, stdio: "pipe" });
}

describe("verify-step.sh", () => {
  beforeAll(() => {
    expect(existsSync(ORIG_HOOK_PATH)).toBe(true);
    tempDir = mkdtempSync(join(tmpdir(), "verify-step-test-"));
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should exist and be executable", () => {
    expect(() =>
      execSync(`test -x "${ORIG_HOOK_PATH}"`, { encoding: "utf-8" }),
    ).not.toThrow();
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${ORIG_HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should print usage when called without arguments", () => {
    try {
      execSync(`bash "${ORIG_HOOK_PATH}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stderr).toContain("用法");
    }
  });

  it("should fail with unknown step", () => {
    const result = runVerifyStep("step9", "cp-test", tempDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("未知的步骤");
  });

  // ─── Step 1 验证 ─────────────────────────────────────────────
  describe("verify_step1", () => {
    const BRANCH = "cp-test-step1";

    it("passes when Task Card has valid node -e test commands", () => {
      const dir = mkdtempSync(join(tempDir, "s1-pass-"));
      createTaskCard(dir, BRANCH, [
        'Test: manual:node -e "const fs=require(\'fs\');if(!fs.existsSync(\'file.sh\'))process.exit(1)"',
        "Test: tests/my.test.ts",
      ]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(0);
    });

    it("fails when no Task Card file exists", () => {
      const dir = mkdtempSync(join(tempDir, "s1-notask-"));
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when Test field is TODO", () => {
      const dir = mkdtempSync(join(tempDir, "s1-todo-"));
      createTaskCard(dir, BRANCH, ["Test: TODO", "Test: TODO"]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when Test field contains echo (fake command)", () => {
      const dir = mkdtempSync(join(tempDir, "s1-echo-"));
      createTaskCard(dir, BRANCH, [
        "Test: manual:echo 'hello'",
        "Test: manual:node -e \"console.log('ok')\"",
      ]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when Test field contains ls (fake command)", () => {
      const dir = mkdtempSync(join(tempDir, "s1-ls-"));
      createTaskCard(dir, BRANCH, ["Test: manual:ls -la packages/"]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when Test field contains cat (fake command)", () => {
      const dir = mkdtempSync(join(tempDir, "s1-cat-"));
      createTaskCard(dir, BRANCH, ["Test: manual:cat file.txt"]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when Test field contains true (fake command)", () => {
      const dir = mkdtempSync(join(tempDir, "s1-true-"));
      createTaskCard(dir, BRANCH, ["Test: manual:true"]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("passes when Task Card has no Test fields (empty DoD)", () => {
      // Task Card without any Test: fields fails (no test evidence)
      const dir = mkdtempSync(join(tempDir, "s1-notests-"));
      const content = `---\nid: test\n---\n# Task Card\n## 验收条件（DoD）\n- [x] 条目\n`;
      writeFileSync(join(dir, `.task-${BRANCH}.md`), content);
      const result = runVerifyStep("step1", BRANCH, dir);
      // No Test: fields → fails verification
      expect(result.exitCode).toBe(1);
    });

    it("passes with contract: test format", () => {
      const dir = mkdtempSync(join(tempDir, "s1-contract-"));
      createTaskCard(dir, BRANCH, ["Test: contract:my-behavior"]);
      const result = runVerifyStep("step1", BRANCH, dir);
      expect(result.exitCode).toBe(0);
    });
  });

  // ─── Step 2 验证 ─────────────────────────────────────────────
  describe("verify_step2", () => {
    const BRANCH = "cp-test-step2";

    it("contains verify_step2 function", () => {
      const { execSync: exec } = require("child_process");
      const content = require("fs").readFileSync(ORIG_HOOK_PATH, "utf8");
      expect(content).toContain("verify_step2");
      expect(content).toContain("没有任何代码改动");
    });

    it("fails when branch has no commits beyond base (no impl files)", () => {
      const dir = mkdtempSync(join(tempDir, "s2-nochange-"));
      initGitRepo(dir, BRANCH);
      // No new commits on feature branch
      const result = runVerifyStep("step2", BRANCH, dir, dir);
      // Empty diff → fail
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("passes when branch has implementation file changes", () => {
      const dir = mkdtempSync(join(tempDir, "s2-haschange-"));
      initGitRepo(dir, BRANCH);
      // Add an impl file
      writeFileSync(join(dir, "my-feature.sh"), "#!/bin/bash\necho done\n");
      execSync("git add my-feature.sh", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "feat: add feature"', { cwd: dir, stdio: "pipe" });
      const result = runVerifyStep("step2", BRANCH, dir, dir);
      expect(result.exitCode).toBe(0);
    });

    it("fails when branch only has doc file changes", () => {
      const dir = mkdtempSync(join(tempDir, "s2-docsonly-"));
      initGitRepo(dir, BRANCH);
      // Only add docs
      mkdirSync(join(dir, "docs"), { recursive: true });
      writeFileSync(join(dir, "docs", "README.md"), "# Docs\n");
      execSync("git add docs/", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "docs: add readme"', { cwd: dir, stdio: "pipe" });
      const result = runVerifyStep("step2", BRANCH, dir, dir);
      // docs/ only → fails (no impl files)
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });
  });

  // ─── Step 4 验证 ─────────────────────────────────────────────
  describe("verify_step4", () => {
    const BRANCH = "cp-test-step4";

    it("contains verify_step4 function and 根本原因 check", () => {
      const content = require("fs").readFileSync(ORIG_HOOK_PATH, "utf8");
      expect(content).toContain("verify_step4");
      expect(content).toContain("根本原因");
    });

    it("fails when no learning file exists", () => {
      const dir = mkdtempSync(join(tempDir, "s4-nofile-"));
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("passes when learning file has all required sections", () => {
      const dir = mkdtempSync(join(tempDir, "s4-pass-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "### 根本原因\n\n问题在于缺少验证。",
        "### 下次预防\n\n- [ ] 添加验证脚本\n- [ ] 写测试",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(0);
    });

    it("fails when learning file missing 根本原因 section", () => {
      const dir = mkdtempSync(join(tempDir, "s4-no-root-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "### 下次预防\n\n- [ ] 预防措施",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when learning file missing 下次预防 section", () => {
      const dir = mkdtempSync(join(tempDir, "s4-no-prev-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "### 根本原因\n\n这是根本原因。",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("fails when learning file has sections but no checklist", () => {
      const dir = mkdtempSync(join(tempDir, "s4-no-checklist-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "### 根本原因\n\n这是根本原因。",
        "### 下次预防\n\n没有 checklist 只有文字。",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("STATE MACHINE");
    });

    it("passes with ## (h2) section headers", () => {
      const dir = mkdtempSync(join(tempDir, "s4-h2-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "## 根本原因\n\n这是根本原因。",
        "## 下次预防\n\n- [ ] 预防措施",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(0);
    });

    it("passes with completed checklist [x]", () => {
      const dir = mkdtempSync(join(tempDir, "s4-checked-"));
      createLearning(dir, BRANCH, [
        "# Learning: Test",
        "### 根本原因\n\n这是根本原因。",
        "### 下次预防\n\n- [x] 已完成的措施",
      ]);
      const result = runVerifyStep("step4", BRANCH, dir);
      expect(result.exitCode).toBe(0);
    });
  });
});
