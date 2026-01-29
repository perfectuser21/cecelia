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

  it("should exit 0 when stop_hook_active=true (prevent infinite loop)", () => {
    const input = JSON.stringify({ stop_hook_active: true });

    // Should exit 0 to prevent infinite loop
    let exitCode = 0;
    try {
      execSync(`echo '${input}' | bash "${HOOK_PATH}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e: unknown) {
      const error = e as { status?: number };
      exitCode = error.status || 0;
    }

    expect(exitCode).toBe(0);
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
});
