/**
 * tests/scripts/pipeline-trace.test.ts
 *
 * 验证 packages/engine/scripts/pipeline-trace.sh 行为：
 *
 * - 文件存在且可执行
 * - 对已知 branch 输出包含 Stage 0-4 状态行
 * - 对不存在 branch 优雅退出（exit 0 + "未找到"）
 * - spec seal verdict 字段显示
 * - spec seal divergence_count 字段显示
 * - crg seal verdict 字段显示
 * - PR URL 字段显示
 * - CI 状态字段显示
 * - Learning 文件存在性
 * - 缺少参数时 exit 1 + usage 提示
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "child_process";
import { resolve, join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "fs";

const ENGINE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(ENGINE_ROOT, "../..");
const SCRIPT = resolve(ENGINE_ROOT, "scripts/pipeline-trace.sh");

// 门禁 2: 显式引用本 PR 修改的源文件，确保 check-changed-coverage 能追踪到
const _PIPELINE_TRACE_SH = resolve(__dirname, "../../scripts/pipeline-trace.sh");

// ──────────────────────────────────────────────
// 测试 fixture（临时目录模拟 branch 证据文件）
// ──────────────────────────────────────────────

const FIXTURE_BRANCH = "test-pipeline-trace-fixture-branch";
const FIXTURE_DIR = join(REPO_ROOT, ".claude/worktrees/_test-pipeline-trace-fixture");
const LEARNING_DIR = join(REPO_ROOT, "docs/learnings");
const LEARNING_FILE = join(LEARNING_DIR, `${FIXTURE_BRANCH}.md`);

function setupFixture() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // .dev-mode
  writeFileSync(
    join(FIXTURE_DIR, `.dev-mode.${FIXTURE_BRANCH}`),
    [
      "dev",
      `branch: ${FIXTURE_BRANCH}`,
      "started: 2026-03-30T10:00:00+08:00",
      "step_0_worktree: done",
      "step_1_spec: done",
      "step_2_code: done",
      "step_3_integrate: done",
      "step_4_ship: done",
      "pr_url: https://github.com/perfectuser21/cecelia/pull/9999",
      "ci_status: success",
      "cleanup_done: true",
    ].join("\n")
  );

  // spec seal
  writeFileSync(
    join(FIXTURE_DIR, `.dev-gate-spec.${FIXTURE_BRANCH}`),
    JSON.stringify({
      verdict: "PASS",
      divergence_count: 3,
      branch: FIXTURE_BRANCH,
      timestamp: "2026-03-30T02:00:00Z",
      reviewer: "spec-review-agent",
    })
  );

  // crg seal
  writeFileSync(
    join(FIXTURE_DIR, `.dev-gate-crg.${FIXTURE_BRANCH}`),
    JSON.stringify({
      verdict: "PASS",
      branch: FIXTURE_BRANCH,
      timestamp: "2026-03-30T03:00:00Z",
      reviewer: "code-review-gate-agent",
    })
  );

  // Learning file
  mkdirSync(LEARNING_DIR, { recursive: true });
  writeFileSync(
    LEARNING_FILE,
    "# Learning\n\n### 根本原因\n\n测试 fixture 的 learning 文件。\n\n### 下次预防\n\n- [ ] 检查 fixture 清理\n"
  );
}

function teardownFixture() {
  if (existsSync(FIXTURE_DIR)) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }
  if (existsSync(LEARNING_FILE)) {
    rmSync(LEARNING_FILE, { force: true });
  }
}

function runTrace(branch: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bash", [SCRIPT, branch], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 15000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ──────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────

describe("pipeline-trace.sh", () => {
  beforeAll(setupFixture);
  afterAll(teardownFixture);

  // ──────────────────────────────────────────────
  // 1. Artifact 测试
  // ──────────────────────────────────────────────
  describe("Artifact: 文件存在性", () => {
    it("脚本文件存在", () => {
      expect(existsSync(SCRIPT)).toBe(true);
    });

    it("脚本文件可执行", () => {
      const stat = statSync(SCRIPT);
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────
  // 2. 参数校验
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: 缺少参数时 exit 1 + usage", () => {
    it("不带参数时 exit 1", () => {
      const result = spawnSync("bash", [SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status).toBe(1);
    });

    it("不带参数时输出 Usage 提示", () => {
      const result = spawnSync("bash", [SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5000,
      });
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      expect(output.toLowerCase()).toMatch(/usage/i);
    });

    it("--help 输出 usage 且 exit 0", () => {
      const result = spawnSync("bash", [SCRIPT, "--help"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status).toBe(0);
      const output = (result.stdout ?? "") + (result.stderr ?? "");
      expect(output.toLowerCase()).toMatch(/usage/i);
    });
  });

  // ──────────────────────────────────────────────
  // 3. 不存在的 branch
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: 不存在的 branch 优雅退出", () => {
    it("exit 0（不崩溃）", () => {
      const { exitCode } = runTrace("cp-99999999-nonexistent-branch-abc123");
      expect(exitCode).toBe(0);
    });

    it("输出包含 '未找到' 或 'not found'", () => {
      const { stdout } = runTrace("cp-99999999-nonexistent-branch-abc123");
      expect(stdout).toMatch(/未找到|not found/i);
    });

    it("不输出 error 堆栈或 undefined", () => {
      const { stdout, stderr } = runTrace("cp-99999999-nonexistent-branch-abc123");
      expect(stdout + stderr).not.toMatch(/Cannot read property|undefined|Error:/);
    });
  });

  // ──────────────────────────────────────────────
  // 4. 正常 branch 的 Stage 0-4 状态行
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: 已完成 branch 输出 Stage 0-4 状态行", () => {
    it("输出包含 Stage 0 行", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/Stage 0/);
    });

    it("输出包含 Stage 1 行", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/Stage 1/);
    });

    it("输出包含 Stage 2 行", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/Stage 2/);
    });

    it("输出包含 Stage 3 行", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/Stage 3/);
    });

    it("输出包含 Stage 4 行", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/Stage 4/);
    });

    it("输出包含 Branch 名称", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain(FIXTURE_BRANCH);
    });
  });

  // ──────────────────────────────────────────────
  // 5. 时间戳
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: 输出包含 started 时间戳", () => {
    it("输出包含 started: 字段", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/started:/);
    });

    it("时间戳格式符合 ISO 8601（含年月日时分秒）", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("时间戳与 fixture .dev-mode 中的 started 一致", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain("2026-03-30T10:00:00+08:00");
    });
  });

  // ──────────────────────────────────────────────
  // 6. Spec seal
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: spec seal verdict 字段", () => {
    it("有 spec seal 时显示 PASS 或 FAIL", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/seal:\s*(PASS|FAIL)/);
    });

    it("显示 PASS（fixture seal verdict = PASS）", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/seal:\s*PASS/);
    });
  });

  describe("BEHAVIOR: spec seal divergence_count 字段", () => {
    it("有 spec seal 时显示 divergence=N", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/divergence=\d+/);
    });

    it("显示正确值（fixture divergence_count = 3）", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain("divergence=3");
    });
  });

  // ──────────────────────────────────────────────
  // 7. CRG seal
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: crg seal verdict 字段", () => {
    it("有 crg seal 时显示 PASS 或 FAIL", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/crg:\s*(PASS|FAIL)/);
    });

    it("显示 PASS（fixture crg verdict = PASS）", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/crg:\s*PASS/);
    });
  });

  // ──────────────────────────────────────────────
  // 8. PR URL
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: PR URL 字段", () => {
    it("输出包含 PR URL", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/PR:\s*https?:\/\//);
    });

    it("PR URL 包含 github.com", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain("github.com");
    });

    it("PR URL 与 fixture 中的值一致", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain("pull/9999");
    });
  });

  // ──────────────────────────────────────────────
  // 9. CI 状态
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: CI 状态字段", () => {
    it("输出包含 CI: 字段", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/CI:\s*(success|failure|pending|unknown)/);
    });

    it("fixture ci_status=success 时显示 success", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/CI:\s*success/);
    });
  });

  // ──────────────────────────────────────────────
  // 10. Learning 文件
  // ──────────────────────────────────────────────
  describe("BEHAVIOR: Learning 文件存在性", () => {
    it("有 Learning 文件时输出包含路径", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toMatch(/learning:\s*docs\/learnings\//);
    });

    it("Learning 文件含 ### 根本原因 时显示 RCA 标记", () => {
      const { stdout } = runTrace(FIXTURE_BRANCH);
      expect(stdout).toContain("RCA");
    });
  });
});
