/**
 * checkFeatHasTests allChangedFiles 参数覆盖率测试
 *
 * 验证 check-changed-coverage.cjs 的 checkFeatHasTests 函数
 * 在传入 allChangedFiles 参数时的行为：无源码文件变更时跳过门禁1。
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { checkFeatHasTests, filterSourceFiles } = require("../../scripts/devgate/check-changed-coverage.cjs");

describe("checkFeatHasTests with allChangedFiles", () => {
  it("feat PR 仅有 .md 文件变更时跳过（无源码）", () => {
    const result = checkFeatHasTests(
      ["feat"],
      [],
      ["README.md", "packages/workflows/skills/dev/SKILL.md"]
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("feat PR 有 .cjs 源码变更但无测试时失败", () => {
    const result = checkFeatHasTests(
      ["feat"],
      [],
      ["packages/engine/scripts/devgate/check-changed-coverage.cjs"]
    );
    expect(result.passed).toBe(false);
  });

  it("filterSourceFiles 排除 .md 和 .yml 文件", () => {
    const files = [
      "packages/workflows/skills/dev/SKILL.md",
      "packages/engine/features/feature-registry.yml",
      "packages/engine/scripts/devgate/check-changed-coverage.cjs",
    ];
    const result = filterSourceFiles(files);
    expect(result).toContain("packages/engine/scripts/devgate/check-changed-coverage.cjs");
    expect(result).not.toContain("packages/workflows/skills/dev/SKILL.md");
    expect(result).not.toContain("packages/engine/features/feature-registry.yml");
  });
});
