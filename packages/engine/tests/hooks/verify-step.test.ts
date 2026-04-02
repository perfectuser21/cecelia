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
    const result = execSync(`bash "${ORIG_HOOK_PATH}" "${step}" "${branch}" "${projectRoot}" 2>&1 1>/dev/null`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd ?? projectRoot,
    });
    // stderr is redirected to stdout via 2>&1, capture it
    return { exitCode: 0, stderr: result || "" };
  } catch (err: any) {
    return { exitCode: err.status ?? 1, stderr: (err.stdout || "") + (err.stderr || "") };
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
      // Gate Planner: Planner seal
      writeFileSync(join(dir, `.dev-gate-planner.${BRANCH}`), "planner_seal: verified\n");
      // Gate Generator: Generator seal
      writeFileSync(join(dir, `.dev-gate-generator-sprint.${BRANCH}`), JSON.stringify({
        sealed_by: "sprint-contract-generator",
        branch: BRANCH,
        timestamp: new Date().toISOString(),
        proposals: [{ dod_item: "test item", proposed_test: "node -e \"process.exit(0)\"" }]
      }));
      // Gate Evaluator: Evaluator seal（divergence_count=1，round=1）
      writeFileSync(join(dir, `.dev-gate-spec.${BRANCH}`), JSON.stringify({
        verdict: "PASS",
        branch: BRANCH,
        timestamp: new Date().toISOString(),
        reviewer: "spec-review-agent",
        independent_test_plans: [{ dod_item: "test item", my_test: "test", agent_test: "other", consistent: false, note: "test divergence" }],
        negotiation_result: { consistent_count: 0, divergence_count: 1, blockers_from_divergence: 0, summary: "test" },
        issues: [],
        summary: "test"
      }));
      // Gate Sprint Contract State: round=1
      writeFileSync(join(dir, `.sprint-contract-state.${BRANCH}`), JSON.stringify({
        branch: BRANCH,
        round: 1,
        timestamp: new Date().toISOString(),
        blocker_count: 0,
        divergence: []
      }));

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
      // Gate Planner 要求 Planner seal 存在
      writeFileSync(join(dir, `.dev-gate-planner.${BRANCH}`), "planner_seal: verified\n");
      // Gate Generator seal
      writeFileSync(join(dir, `.dev-gate-generator-sprint.${BRANCH}`), JSON.stringify({
        sealed_by: "sprint-contract-generator", branch: BRANCH, timestamp: new Date().toISOString(),
        proposals: [{ dod_item: "test item", proposed_test: "node -e \"process.exit(0)\"" }]
      }));
      // Gate Evaluator seal (verdict=PASS, divergence_count=1)
      writeFileSync(join(dir, `.dev-gate-spec.${BRANCH}`), JSON.stringify({
        verdict: "PASS", branch: BRANCH, timestamp: new Date().toISOString(),
        reviewer: "spec-review-agent",
        independent_test_plans: [{ dod_item: "test item", my_test: "test", agent_test: "other", consistent: false, note: "divergence" }],
        negotiation_result: { consistent_count: 0, divergence_count: 1, blockers_from_divergence: 0, summary: "test" },
        issues: [], summary: "test"
      }));
      // Gate Sprint Contract State (round=1)
      writeFileSync(join(dir, `.sprint-contract-state.${BRANCH}`), JSON.stringify({
        branch: BRANCH, round: 1, timestamp: new Date().toISOString(), blocker_count: 0, divergence: []
      }));

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

    it("contains Gate 2 DoD execution logic", () => {
      const content = require("fs").readFileSync(ORIG_HOOK_PATH, "utf8");
      expect(content).toContain("Gate 2");
      expect(content).toContain("IN_DOD");  // 支持 [BEHAVIOR]/[ARTIFACT]/[GATE] 三种类型
      expect(content).toContain("FAILED_ITEMS");
      expect(content).toContain("DEFERRED");
      expect(content).toContain("DOD_TOTAL");
    });

    it("Gate 2 executes manual: Test commands from Task Card", () => {
      const dir = mkdtempSync(join(tempDir, "s2-gate2-manual-"));
      initGitRepo(dir, BRANCH);
      // Create a test file that the manual command will check
      writeFileSync(join(dir, "feature.sh"), "#!/bin/bash\necho ok\n");
      execSync("git add feature.sh", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "feat: add feature"', { cwd: dir, stdio: "pipe" });

      // Task Card with BEHAVIOR that checks for feature.sh
      const taskContent = `---
id: task-${BRANCH}
type: task-card
---

# Task Card

## 验收条件（DoD）

- [x] [BEHAVIOR] feature.sh 存在
  Test: manual:bash -c "test -f feature.sh"

- [x] [GATE] 通过
  Test: manual:bash -c "echo pass"
`;
      writeFileSync(join(dir, `.task-${BRANCH}.md`), taskContent, "utf-8");

      const result = runVerifyStep("step2", BRANCH, dir, dir);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("Gate 2");
      expect(result.stderr).toContain("PASS");
    });

    it("Gate 2 marks contract: tests as DEFERRED", () => {
      const dir = mkdtempSync(join(tempDir, "s2-gate2-contract-"));
      initGitRepo(dir, BRANCH);
      writeFileSync(join(dir, "feature.sh"), "#!/bin/bash\necho ok\n");
      execSync("git add feature.sh", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "feat: add feature"', { cwd: dir, stdio: "pipe" });

      const taskContent = `---
id: task-${BRANCH}
type: task-card
---

# Task Card

## 验收条件（DoD）

- [x] [BEHAVIOR] 合约验证
  Test: contract:my-behavior

- [x] [GATE] 通过
  Test: manual:bash -c "echo pass"
`;
      writeFileSync(join(dir, `.task-${BRANCH}.md`), taskContent, "utf-8");

      const result = runVerifyStep("step2", BRANCH, dir, dir);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("DEFERRED");
    });

    it("Gate 2 fails when manual: Test command fails", () => {
      const dir = mkdtempSync(join(tempDir, "s2-gate2-fail-"));
      initGitRepo(dir, BRANCH);
      writeFileSync(join(dir, "feature.sh"), "#!/bin/bash\necho ok\n");
      execSync("git add feature.sh", { cwd: dir, stdio: "pipe" });
      execSync('git commit -m "feat: add feature"', { cwd: dir, stdio: "pipe" });

      const taskContent = `---
id: task-${BRANCH}
type: task-card
---

# Task Card

## 验收条件（DoD）

- [x] [BEHAVIOR] 不存在的文件检查
  Test: manual:bash -c "test -f nonexistent-file-xyz"

- [x] [GATE] 通过
  Test: manual:bash -c "echo pass"
`;
      writeFileSync(join(dir, `.task-${BRANCH}.md`), taskContent, "utf-8");

      const result = runVerifyStep("step2", BRANCH, dir, dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Gate 2 失败");
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

describe("verify-step.sh symlink path resolution", () => {
  it("resolves physical path via pwd -P (symlink safety)", () => {
    // verify-step.sh uses pwd -P to get the physical path when invoked
    // through a symlink (hooks/ → packages/engine/hooks/).
    // This test confirms the script contains the symlink-safe path resolution pattern.
    const { readFileSync } = require("fs");
    const { resolve } = require("path");
    const scriptPath = resolve(__dirname, "../../hooks/verify-step.sh");
    const content = readFileSync(scriptPath, "utf8");
    // Must use pwd -P to get the physical (not logical) directory path
    expect(content).toContain("pwd -P");
  });
});

describe.skip("verify-step.sh LITE 路径豁免 [已删除: LITE/FULL路径+subagent gates]", () => {
  const BRANCH = "cp-test-lite";
  let liteTestDir: string;

  beforeAll(() => {
    expect(existsSync(ORIG_HOOK_PATH)).toBe(true);
    liteTestDir = mkdtempSync(join(tmpdir(), "verify-step-lite-"));
  });

  afterAll(() => {
    if (liteTestDir && existsSync(liteTestDir)) {
      rmSync(liteTestDir, { recursive: true, force: true });
    }
  });

  it("verify-step.sh 包含 LITE 路径检测逻辑", () => {
    const content = require("fs").readFileSync(ORIG_HOOK_PATH, "utf8");
    // Must contain LITE mode detection
    const hasLite = content.includes("lite_routing") || content.includes("lite_seal_file") || content.includes("Gate LITE");
    expect(hasLite).toBe(true);
  });

  it("LITE 模式：.dev-gate-lite 存在且 routing_decision=lite → 跳过 Sprint Contract seal 检查", () => {
    const dir = mkdtempSync(join(liteTestDir, "s1-lite-"));
    createTaskCard(dir, BRANCH, [
      'Test: manual:node -e "const fs=require(\'fs\');if(!fs.existsSync(\'file.sh\'))process.exit(1)"',
    ]);
    // 只创建 LITE seal，不创建 Sprint Contract seals
    writeFileSync(
      join(dir, `.dev-gate-lite.${BRANCH}`),
      JSON.stringify({
        sealed_by: "main-agent-lite-routing",
        branch: BRANCH,
        timestamp: new Date().toISOString(),
        routing_decision: "lite",
        conditions: {
          L1_commit_type: true,
          L2_no_new_features: true,
          L3_files_count: true,
          L4_no_new_api: true,
          L5_no_core_files: true,
        },
      }),
    );
    // 不创建 Planner/Generator/Evaluator/ContractState seal → LITE 模式应跳过这些检查

    const result = runVerifyStep("step1", BRANCH, dir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("LITE");
  });

  it("FULL 模式：无 .dev-gate-lite → 要求 Planner seal", () => {
    const dir = mkdtempSync(join(liteTestDir, "s1-full-noplanner-"));
    createTaskCard(dir, BRANCH, [
      'Test: manual:node -e "process.exit(0)"',
    ]);
    // 无 LITE seal，无 Planner seal → 应失败
    const result = runVerifyStep("step1", BRANCH, dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Planner");
  });
});
