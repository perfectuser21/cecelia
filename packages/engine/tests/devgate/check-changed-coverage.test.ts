import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  parseUnifiedDiff,
  findCoverageKey,
  extractImports,
  countCoveredLines,
} = require("../../scripts/devgate/check-changed-coverage.cjs");

// ─── parseUnifiedDiff ─────────────────────────────────────────────────────

describe("parseUnifiedDiff", () => {
  it("空 diff 返回空对象", () => {
    expect(parseUnifiedDiff("")).toEqual({});
  });

  it("解析单文件新增行", () => {
    const diff = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -0,0 +1,3 @@",
      "+line1",
      "+line2",
      "+line3",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result["src/foo.ts"]).toEqual([1, 2, 3]);
  });

  it("跳过删除行（- 开头）", () => {
    const diff = [
      "+++ b/src/bar.ts",
      "@@ -1,2 +1,2 @@",
      "-old line",
      "+new line",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    // 只有 +new line 是新增
    expect(result["src/bar.ts"]).toEqual([1]);
  });

  it("处理多文件 diff", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -0,0 +1,2 @@",
      "+a1",
      "+a2",
      "+++ b/src/b.ts",
      "@@ -0,0 +5,1 @@",
      "+b1",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    expect(result["src/a.ts"]).toEqual([1, 2]);
    expect(result["src/b.ts"]).toEqual([5]);
  });

  it("处理有上下文的 @@ 偏移量", () => {
    const diff = [
      "+++ b/src/c.ts",
      "@@ -10,3 +10,4 @@",
      " context",
      "+inserted",
      " context2",
    ].join("\n");

    const result = parseUnifiedDiff(diff);
    // context 占 line 10，inserted 是 line 11
    expect(result["src/c.ts"]).toContain(11);
  });
});

// ─── findCoverageKey ──────────────────────────────────────────────────────

describe("findCoverageKey", () => {
  it("精确匹配相对路径", () => {
    const data = { "src/foo.ts": {} };
    expect(findCoverageKey(data, "src/foo.ts")).toBe("src/foo.ts");
  });

  it("匹配绝对路径中包含相对路径", () => {
    const data = { "/home/user/project/src/foo.ts": {} };
    expect(findCoverageKey(data, "src/foo.ts")).toBe(
      "/home/user/project/src/foo.ts"
    );
  });

  it("basename 兜底匹配", () => {
    const data = { "/some/deep/path/foo.ts": {} };
    expect(findCoverageKey(data, "different/path/foo.ts")).toBe(
      "/some/deep/path/foo.ts"
    );
  });

  it("未找到返回 null", () => {
    const data = { "/path/bar.ts": {} };
    expect(findCoverageKey(data, "src/foo.ts")).toBeNull();
  });
});

// ─── extractImports ───────────────────────────────────────────────────────

describe("extractImports", () => {
  it("提取 ES module import", () => {
    const content = `
import { foo } from './foo';
import type { Bar } from '../bar';
    `;
    const result = extractImports(content);
    expect(result).toContain("./foo");
    expect(result).toContain("../bar");
  });

  it("提取 require()", () => {
    const content = `
const { fn } = require('../scripts/helper.cjs');
const x = require("./other");
    `;
    const result = extractImports(content);
    expect(result).toContain("../scripts/helper.cjs");
    expect(result).toContain("./other");
  });

  it("内容为空返回空数组", () => {
    expect(extractImports("")).toEqual([]);
  });

  it("不含 import 的代码返回空数组", () => {
    const content = "const x = 1; console.log(x);";
    expect(extractImports(content)).toEqual([]);
  });
});

// ─── countCoveredLines ────────────────────────────────────────────────────

describe("countCoveredLines", () => {
  const mockFileCoverage = {
    statementMap: {
      "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
      "1": { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
      "2": { start: { line: 3, column: 0 }, end: { line: 3, column: 20 } },
    },
    s: {
      "0": 3, // covered (3 calls)
      "1": 0, // not covered
      "2": 1, // covered
    },
  };

  it("统计已覆盖行数", () => {
    const { covered, total } = countCoveredLines(mockFileCoverage, [1, 2, 3]);
    expect(covered).toBe(2); // line 1 and 3 covered
    expect(total).toBe(3);
  });

  it("全部覆盖", () => {
    const { covered, total } = countCoveredLines(mockFileCoverage, [1, 3]);
    expect(covered).toBe(2);
    expect(total).toBe(2);
  });

  it("全部未覆盖", () => {
    const { covered, total } = countCoveredLines(mockFileCoverage, [2]);
    expect(covered).toBe(0);
    expect(total).toBe(1);
  });

  it("空行列表返回 0/0", () => {
    const { covered, total } = countCoveredLines(mockFileCoverage, []);
    expect(covered).toBe(0);
    expect(total).toBe(0);
  });

  it("不在 statementMap 中的行视为未覆盖", () => {
    const { covered, total } = countCoveredLines(mockFileCoverage, [99]);
    expect(covered).toBe(0);
    expect(total).toBe(1);
  });
});
