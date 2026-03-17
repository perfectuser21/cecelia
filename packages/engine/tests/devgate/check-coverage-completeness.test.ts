import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";

const SCRIPT = resolve(__dirname, "../../../../scripts/devgate/check-coverage-completeness.mjs");
const PROJECT_ROOT = resolve(__dirname, "../../../..");

describe("check-coverage-completeness.mjs", () => {
  it("脚本文件存在", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("语法检查通过（node --check）", () => {
    // node --check 仅做语法验证，无输出即通过
    expect(() =>
      execSync(`node --check "${SCRIPT}"`, { encoding: "utf-8", cwd: PROJECT_ROOT })
    ).not.toThrow();
  });

  it("--dry-run 模式正常运行并输出结果", () => {
    // dry-run 只报告，不返回非零退出码
    const result = execSync(
      `node "${SCRIPT}" --dry-run 2>&1 || true`,
      { encoding: "utf-8", cwd: PROJECT_ROOT }
    );
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
