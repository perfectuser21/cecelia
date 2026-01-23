/**
 * pr-gate-v2.sh 最小测试
 *
 * 测试 PR Gate Hook 的核心逻辑：
 * 1. 只拦截 gh pr create 命令
 * 2. 其他命令直接放行
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Helper to safely run hook with JSON input via stdin
 * This avoids shell injection issues with complex JSON strings
 */
function runHookWithInput(hookPath: string, input: string, env?: NodeJS.ProcessEnv): { stdout: string; exitCode: number } {
  const result = spawnSync('bash', [hookPath], {
    input,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout || '',
    exitCode: result.status ?? -1,
  };
}

const HOOK_PATH = resolve(__dirname, "../../hooks/pr-gate-v2.sh");

describe("pr-gate-v2.sh", () => {
  beforeAll(() => {
    expect(existsSync(HOOK_PATH)).toBe(true);
  });

  it("should exist and be executable", () => {
    const stat = execSync(`stat -c %a "${HOOK_PATH}"`, { encoding: "utf-8" });
    const mode = parseInt(stat.trim(), 8);
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it("should pass syntax check", () => {
    expect(() => {
      execSync(`bash -n "${HOOK_PATH}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should exit 0 for non-Bash operations", () => {
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.ts" },
    });

    const { stdout, exitCode } = runHookWithInput(HOOK_PATH, input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("should exit 0 for non-gh-pr-create commands", () => {
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });

    const { stdout, exitCode } = runHookWithInput(HOOK_PATH, input);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });

  it("should support MODE environment variable", () => {
    // Just test that the script accepts PR_GATE_MODE without crashing
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "echo test" },
    });

    // Test with pr mode
    const prResult = runHookWithInput(HOOK_PATH, input, { PR_GATE_MODE: 'pr' });
    expect(prResult.exitCode).toBe(0);

    // Test with release mode
    const releaseResult = runHookWithInput(HOOK_PATH, input, { PR_GATE_MODE: 'release' });
    expect(releaseResult.exitCode).toBe(0);
  });
});
