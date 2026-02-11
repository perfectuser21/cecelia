/**
 * Stop Exploratory Hook 测试
 *
 * 验证 hooks/stop-exploratory.sh 在不同场景下返回正确的 exit 代码：
 * - exit 0: 允许会话结束（PRD/DOD 生成完成，worktree 已清理）
 * - exit 2: 阻止会话结束（PRD/DOD 未生成或 worktree 未清理）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, mkdirSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const STOP_EXPLORATORY_HOOK = join(__dirname, "../../hooks/stop-exploratory.sh");

describe("hooks/stop-exploratory.sh exit codes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "stop-exploratory-test-"));
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
    it("should return exit 0 when no .exploratory-mode exists", () => {
      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );
      // Extract just the exit code from the last line
      const exitCode = result.trim().split("\n").pop();
      expect(exitCode).toBe("0");
    });

    it("should return exit 0 when PRD/DOD generated and worktree cleaned", () => {
      const timestamp = "20260211123456";

      // 创建 .exploratory-mode 文件
      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: test task\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:34:56+00:00\n`
      );

      // 创建 PRD 和 DOD 文件
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.prd.md`),
        "# PRD\n\nTest PRD content\n"
      );
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.dod.md`),
        "# DOD\n\n- [ ] Test acceptance criteria\n"
      );

      // worktree 已清理（不存在）

      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );

      const exitCode = result.trim().split("\n").pop();
      expect(exitCode).toBe("0");

      // 验证 .exploratory-mode 已被删除
      expect(existsSync(join(tempDir, ".exploratory-mode"))).toBe(false);
    });
  });

  describe("exit 2 scenarios (prevent session end)", () => {
    it("should return exit 2 when .exploratory-mode exists but PRD missing", () => {
      const timestamp = "20260211123456";

      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: test task\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:34:56+00:00\n`
      );

      // 只创建 DOD，PRD 缺失
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.dod.md`),
        "# DOD\n\n- [ ] Test acceptance criteria\n"
      );

      let exitCode = "unknown";
      try {
        execSync(
          `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null`,
          { encoding: "utf-8" }
        );
      } catch (err: any) {
        exitCode = String(err.status);
      }

      expect(exitCode).toBe("2");
    });

    it("should return exit 2 when .exploratory-mode exists but DOD missing", () => {
      const timestamp = "20260211123456";

      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: test task\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:34:56+00:00\n`
      );

      // 只创建 PRD，DOD 缺失
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.prd.md`),
        "# PRD\n\nTest PRD content\n"
      );

      let exitCode = "unknown";
      try {
        execSync(
          `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null`,
          { encoding: "utf-8" }
        );
      } catch (err: any) {
        exitCode = String(err.status);
      }

      expect(exitCode).toBe("2");
    });

    it("should return exit 2 when worktree not cleaned", () => {
      const timestamp = "20260211123456";
      const worktreePath = join(tempDir, `exp-${timestamp}`);

      // 创建 worktree 目录（模拟未清理）
      mkdirSync(worktreePath);

      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: test task\nworktree: ${worktreePath}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:34:56+00:00\n`
      );

      // 创建 PRD 和 DOD 文件
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.prd.md`),
        "# PRD\n\nTest PRD content\n"
      );
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.dod.md`),
        "# DOD\n\n- [ ] Test acceptance criteria\n"
      );

      let exitCode = "unknown";
      try {
        execSync(
          `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null`,
          { encoding: "utf-8" }
        );
      } catch (err: any) {
        exitCode = String(err.status);
      }

      expect(exitCode).toBe("2");
    });

    it("should return exit 2 when all files missing", () => {
      const timestamp = "20260211123456";

      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: test task\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:34:56+00:00\n`
      );

      // 不创建任何 PRD/DOD 文件

      let exitCode = "unknown";
      try {
        execSync(
          `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null`,
          { encoding: "utf-8" }
        );
      } catch (err: any) {
        exitCode = String(err.status);
      }

      expect(exitCode).toBe("2");
    });
  });

  describe("file content validation", () => {
    it("should check that stop-exploratory.sh contains required checks", () => {
      const content = execSync(`cat "${STOP_EXPLORATORY_HOOK}"`, { encoding: "utf-8" });

      // 验证包含必要的检查逻辑
      expect(content).toContain(".exploratory-mode");
      expect(content).toContain("worktree:");
      expect(content).toContain("timestamp:");
      expect(content).toContain(".prd.md");
      expect(content).toContain(".dod.md");
      expect(content).toContain("exit 0");
      expect(content).toContain("exit 2");
    });

    it("should have executable permission", () => {
      const stat = execSync(`stat -c "%a" "${STOP_EXPLORATORY_HOOK}"`, { encoding: "utf-8" });
      // Should be executable (e.g., 755, 775, 777)
      const permissions = stat.trim();
      expect(["755", "775", "777", "655", "675"]).toContain(permissions);
    });
  });
});
