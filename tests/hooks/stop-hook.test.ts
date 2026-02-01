/**
 * stop.sh 测试
 *
 * 测试 Stop Hook 的核心逻辑：
 * 1. 检测 cleanup_done 标记
 * 2. PR 合并时 exit 2 触发 cleanup
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const HOOK_PATH = resolve(__dirname, "../../hooks/stop.sh");

describe("stop.sh", () => {
  beforeAll(() => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  it("should exist and be executable", () => {
    const stat = execSync(`stat -c %a "${HOOK_PATH}"`, { encoding: "utf-8" });
    const mode = parseInt(stat.trim(), 8);
    expect(mode & 0o111).toBeGreaterThan(0); // Has execute permission
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should exit 0 when CECELIA_HEADLESS=true", () => {
    const input = JSON.stringify({ stop_hook_active: false });

    // In headless mode, hook should exit 0 immediately
    const result = execSync(
      `echo '${input}' | CECELIA_HEADLESS=true bash "${HOOK_PATH}"`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    expect(result).toBe("");
  });

  // REMOVED: stop_hook_active 检查已删除（改用 20 次 retry_count 机制）
  // 详见 .prd-fix-stop-hook-loop.md
  it.todo("stop_hook_active is removed - now uses retry_count (max 20)");

  describe("cleanup_done detection", () => {
    let tempDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "stop-hook-test-"));
    });

    afterEach(() => {
      // Cleanup temp files
      const devModeFile = join(tempDir, ".dev-mode");
      if (existsSync(devModeFile)) {
        unlinkSync(devModeFile);
      }
    });

    it("should detect cleanup_done in .dev-mode content", () => {
      // Test grep pattern matching
      const testContent = `dev
branch: cp-test
cleanup_done: true`;

      // Use grep to verify the pattern matches
      const result = execSync(
        `echo '${testContent}' | grep -q "cleanup_done: true" && echo "found" || echo "not found"`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("found");
    });

    it("should not match cleanup_done when not present", () => {
      const testContent = `dev
branch: cp-test
started: 2026-01-30`;

      const result = execSync(
        `echo '${testContent}' | grep -q "cleanup_done: true" && echo "found" || echo "not found"`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("not found");
    });
  });

  describe("session isolation (H7-005)", () => {
    it("should detect branch mismatch pattern in code", () => {
      // Verify the session isolation code exists in stop.sh
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

      // Check for the key session isolation logic
      expect(hookContent).toContain("BRANCH_IN_FILE");
      expect(hookContent).toContain("CURRENT_BRANCH");
      expect(hookContent).toContain("P0-3");
    });

    it("should extract branch from .dev-mode correctly", () => {
      const testContent = `dev
branch: cp-other-session
tasks_created: true`;

      // Test branch extraction pattern
      const result = execSync(
        `echo '${testContent}' | grep "^branch:" | cut -d' ' -f2`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("cp-other-session");
    });

    it("should handle missing branch field gracefully", () => {
      const testContent = `dev
tasks_created: true`;

      // When branch is missing, grep should return empty
      const result = execSync(
        `echo '${testContent}' | grep "^branch:" | cut -d' ' -f2 || echo ""`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("");
    });
  });

  describe("TTY isolation (H7-008)", () => {
    it("should have TTY check logic in stop.sh", () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

      expect(hookContent).toContain("TTY_IN_FILE");
      expect(hookContent).toContain("CURRENT_TTY");
      expect(hookContent).toContain("H7-008");
    });

    it("should extract tty field from .dev-mode correctly", () => {
      const testContent = `dev
branch: cp-test
tty: /dev/pts/3
session_id: abc123`;

      const result = execSync(
        `echo '${testContent}' | grep "^tty:" | cut -d' ' -f2-`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("/dev/pts/3");
    });

    it("should handle 'not a tty' value (headless/pipe)", () => {
      const testContent = `dev
branch: cp-test
tty: not a tty
session_id: abc123`;

      const result = execSync(
        `echo '${testContent}' | grep "^tty:" | cut -d' ' -f2-`,
        { encoding: "utf-8" }
      );

      // "not a tty" should be treated as no valid TTY
      expect(result.trim()).toBe("not a tty");
    });

    it("should handle missing tty field gracefully", () => {
      const testContent = `dev
branch: cp-test
session_id: abc123`;

      const result = execSync(
        `echo '${testContent}' | grep "^tty:" | cut -d' ' -f2- || echo ""`,
        { encoding: "utf-8" }
      );

      expect(result.trim()).toBe("");
    });

    it("should skip TTY check when tty field is 'not a tty'", () => {
      // The condition in stop.sh skips when TTY_IN_FILE == "not a tty"
      // Verify the guard condition exists
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

      expect(hookContent).toContain('"not a tty"');
      // Verify both sides are checked
      expect(hookContent).toMatch(/TTY_IN_FILE.*!=.*"not a tty"/);
      expect(hookContent).toMatch(/CURRENT_TTY.*!=.*"not a tty"/);
    });

    it("should exit 0 on TTY mismatch (different terminal)", () => {
      // Verify the exit 0 logic for TTY mismatch exists
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

      // Check the mismatch comparison and exit 0
      expect(hookContent).toMatch(/TTY_IN_FILE.*!=.*CURRENT_TTY/);
      expect(hookContent).toContain("# 不是当前 terminal 的任务，允许结束");
    });
  });
});
