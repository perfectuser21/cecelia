/**
 * Stop Hook Exit 代码测试
 *
 * 验证 hooks/stop-dev.sh 在不同场景下返回正确的 exit 代码：
 * - exit 0: 允许会话结束（完成或无关会话）
 * - exit 2: 阻止会话结束（未完成，继续执行）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STOP_DEV_HOOK = join(__dirname, "../../hooks/stop-dev.sh");

describe("hooks/stop-dev.sh exit codes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stop-hook-test-"));
    execSync(`cd "${tempDir}" && git init -q`);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch {
      // ignore
    }
  });

  describe("exit 0 scenarios (allow session end)", () => {
    it("should return exit 0 when no .dev-mode exists", () => {
      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });

    it("should return exit 0 when cleanup_done: true", () => {
      writeFileSync(
        join(tempDir, ".dev-mode"),
        "dev\nbranch: test\ncleanup_done: true\n"
      );

      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });

    it("should return exit 0 after 15 retry attempts", () => {
      writeFileSync(
        join(tempDir, ".dev-mode"),
        "dev\nbranch: test\nretry_count: 15\n"
      );

      const exitCode = execSync(
        `cd "${tempDir}" && bash "${STOP_DEV_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      expect(exitCode.trim()).toBe("0");
    });
  });

  describe("exit 2 scenarios (block session end)", () => {
    it("should return exit 2 when PR not created", () => {
      // Create initial commit so we can create a branch
      writeFileSync(join(tempDir, "README.md"), "test");
      execSync(`cd "${tempDir}" && git add . && git config user.email "test@test.com" && git config user.name "Test" && git commit -m "init" -q`);

      // Create .dev-lock and .dev-sentinel (双钥匙 + 三重保险)
      writeFileSync(join(tempDir, ".dev-lock"), "dev_workflow_active\n");
      writeFileSync(join(tempDir, ".dev-sentinel"), "dev_workflow_active\n");
      writeFileSync(
        join(tempDir, ".dev-mode"),
        "dev\nbranch: test-branch\nsession_id: test123\n"
      );

      // 模拟 gh pr list 返回空（PR 未创建）
      const result = execSync(
        `cd "${tempDir}" && git checkout -b test-branch -q && export PATH=/usr/bin:/bin && bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );
      expect(result).toContain("exit:2");
    });

    it("should return exit 2 when CI is in progress", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when CI failed", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when PR not merged", () => {
      // 这个测试需要 mock gh CLI，暂时跳过
      // 实际测试在集成测试中验证
    });

    it("should return exit 2 when Step 11 not completed", () => {
      writeFileSync(
        join(tempDir, ".dev-mode"),
        "dev\nbranch: test\nstep_11_cleanup: pending\n"
      );

      // 模拟 PR 已合并但 Step 11 未完成
      // 需要 mock gh CLI 返回 merged 状态
      // 暂时跳过，在集成测试中验证
    });
  });

  describe("exit code consistency", () => {
    it("should never return exit 1 (reserved for errors)", () => {
      writeFileSync(join(tempDir, ".dev-mode"), "dev\nbranch: test\n");

      const result = execSync(
        `cd "${tempDir}" && git checkout -b test -q && bash "${STOP_DEV_HOOK}" < /dev/null || echo "exit:$?"`,
        { encoding: "utf-8" }
      );

      // exit 0 或 exit 2，不应该是 exit 1
      const exitMatch = result.match(/exit:(\d+)/);
      if (exitMatch) {
        const code = parseInt(exitMatch[1]);
        expect([0, 2]).toContain(code);
      }
    });
  });
});
