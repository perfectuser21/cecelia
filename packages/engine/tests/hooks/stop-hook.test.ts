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
    // Use cross-platform test -x instead of Linux-only stat -c %a
    expect(() => execSync(`test -x "${HOOK_PATH}"`, { encoding: "utf-8" })).not.toThrow();
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should NOT bypass when CECELIA_HEADLESS=true (H7-014 Bug Fix)", () => {
    // v14.0.0: 无头模式不再绕过，与有头模式走同一套状态机
    // 验证绕过逻辑已从可执行代码中删除（注释中允许提及）
    const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

    // 验证没有 if [[ ... CECELIA_HEADLESS ... ]] 形式的可执行绕过
    expect(hookContent).not.toMatch(/^\s*if\s+\[\[.*CECELIA_HEADLESS/m);
    // 验证版本已升级到 v14.0.0
    expect(hookContent).toContain('v14.0.0');
  });

  describe("Router architecture (v13.0.0)", () => {
    it("stop.sh should be a router that delegates to mode-specific hooks", () => {
      const hookContent = execSync(`cat "${HOOK_PATH}"`, { encoding: "utf-8" });

      // Verify router architecture
      expect(hookContent).toContain('Stop Hook 路由器');
      expect(hookContent).toContain('stop-dev.sh');
      expect(hookContent).toContain('.dev-mode');
      expect(hookContent).toContain('v14.0.0');
    });

    it("should validate JSON output format", () => {
      // Test that jq produces valid JSON
      const result = execSync(
        `jq -n --arg reason "Test reason" '{"decision": "block", "reason": $reason}'`,
        { encoding: "utf-8" }
      );

      const json = JSON.parse(result);
      expect(json.decision).toBe("block");
      expect(json.reason).toBe("Test reason");
    });

    it("stop-dev.sh should have all exit 2 replaced with JSON API + exit 2", () => {
      const stopDevPath = HOOK_PATH.replace('stop.sh', 'stop-dev.sh');
      const hookContent = execSync(`cat "${stopDevPath}"`, { encoding: "utf-8" });

      // stop-dev.sh still uses exit 2 for blocking (JSON API is for providing context)
      // The router (stop.sh) receives the exit code
      expect(hookContent).toContain('jq -n');
      expect(hookContent).toContain('exit 2');
    });
  });

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

  });
});
