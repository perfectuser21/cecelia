import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Import the module under test
const mod = require("../../scripts/devgate/check-changed-coverage.cjs");

const {
  isFeatPR,
  filterSourceFiles,
  filterNewTestFiles,
  testImportsSourceFile,
  isLineCovered,
  calculateChangedLineCoverage,
  checkFeatHasTests,
  checkTestImportsSource,
  checkChangedLineCoverage,
} = mod;

// ─── isFeatPR ─────────────────────────────────────────────────────

describe("isFeatPR", () => {
  it("返回 true 当 commit 类型包含 feat", () => {
    expect(isFeatPR(["feat", "fix"])).toBe(true);
  });

  it("返回 false 当 commit 类型不包含 feat", () => {
    expect(isFeatPR(["fix", "docs", "chore"])).toBe(false);
  });

  it("返回 false 当 commit 类型为空", () => {
    expect(isFeatPR([])).toBe(false);
  });
});

// ─── filterSourceFiles ────────────────────────────────────────────

describe("filterSourceFiles", () => {
  it("保留 .ts 和 .js 源码文件", () => {
    const files = ["src/index.ts", "src/utils.js", "lib/helper.mjs"];
    expect(filterSourceFiles(files)).toEqual([
      "src/index.ts",
      "src/utils.js",
      "lib/helper.mjs",
    ]);
  });

  it("排除测试文件", () => {
    const files = [
      "src/index.ts",
      "src/index.test.ts",
      "tests/helper.spec.js",
    ];
    expect(filterSourceFiles(files)).toEqual(["src/index.ts"]);
  });

  it("排除配置文件", () => {
    const files = ["src/index.ts", "vitest.config.ts", "jest.config.js"];
    expect(filterSourceFiles(files)).toEqual(["src/index.ts"]);
  });

  it("排除非代码文件", () => {
    const files = ["README.md", "package.json", ".gitignore", "src/index.ts"];
    expect(filterSourceFiles(files)).toEqual(["src/index.ts"]);
  });

  it("排除 __tests__ 目录下的文件", () => {
    const files = ["src/index.ts", "src/__tests__/helper.ts"];
    expect(filterSourceFiles(files)).toEqual(["src/index.ts"]);
  });
});

// ─── filterNewTestFiles ───────────────────────────────────────────

describe("filterNewTestFiles", () => {
  it("识别 .test.ts 文件", () => {
    const files = ["src/index.ts", "tests/foo.test.ts", "tests/bar.spec.js"];
    expect(filterNewTestFiles(files)).toEqual([
      "tests/foo.test.ts",
      "tests/bar.spec.js",
    ]);
  });

  it("空列表返回空", () => {
    expect(filterNewTestFiles([])).toEqual([]);
  });
});

// ─── testImportsSourceFile ────────────────────────────────────────

describe("testImportsSourceFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-test-"));
  });

  it("检测 ESM import", () => {
    const testDir = path.join(tmpDir, "tests");
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "foo.test.ts"),
      `import { foo } from '../src/foo';\ndescribe('foo', () => {});`
    );
    fs.writeFileSync(path.join(srcDir, "foo.ts"), "export function foo() {}");

    expect(
      testImportsSourceFile("tests/foo.test.ts", ["src/foo.ts"], tmpDir)
    ).toBe(true);
  });

  it("检测 CJS require", () => {
    const testDir = path.join(tmpDir, "tests");
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "bar.test.js"),
      `const bar = require('../src/bar');\ntest('bar', () => {});`
    );
    fs.writeFileSync(path.join(srcDir, "bar.js"), "module.exports = {}");

    expect(
      testImportsSourceFile("tests/bar.test.js", ["src/bar.js"], tmpDir)
    ).toBe(true);
  });

  it("未 import 源码返回 false", () => {
    const testDir = path.join(tmpDir, "tests");
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "orphan.test.ts"),
      `import { vi } from 'vitest';\ndescribe('orphan', () => {});`
    );

    expect(
      testImportsSourceFile(
        "tests/orphan.test.ts",
        ["src/unrelated.ts"],
        tmpDir
      )
    ).toBe(false);
  });
});

// ─── isLineCovered ────────────────────────────────────────────────

describe("isLineCovered", () => {
  const fileCoverage = {
    statementMap: {
      "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } },
      "1": { start: { line: 3, column: 0 }, end: { line: 5, column: 1 } },
      "2": { start: { line: 7, column: 0 }, end: { line: 7, column: 20 } },
    },
    s: {
      "0": 5, // 行 1 覆盖
      "1": 0, // 行 3-5 未覆盖
      "2": 3, // 行 7 覆盖
    },
  };

  it("已覆盖行返回 true", () => {
    expect(isLineCovered(fileCoverage, 1)).toBe(true);
    expect(isLineCovered(fileCoverage, 7)).toBe(true);
  });

  it("未覆盖行返回 false", () => {
    expect(isLineCovered(fileCoverage, 3)).toBe(false);
    expect(isLineCovered(fileCoverage, 4)).toBe(false);
    expect(isLineCovered(fileCoverage, 5)).toBe(false);
  });

  it("不在 statementMap 中的行返回 false", () => {
    expect(isLineCovered(fileCoverage, 10)).toBe(false);
  });

  it("null fileCoverage 返回 false", () => {
    expect(isLineCovered(null, 1)).toBe(false);
  });
});

// ─── calculateChangedLineCoverage ─────────────────────────────────

describe("calculateChangedLineCoverage", () => {
  it("正确计算变更行覆盖率", () => {
    const changedLines = new Map([["src/foo.ts", [1, 3, 7]]]);

    const coverageData = {
      "/project/src/foo.ts": {
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 30 },
          },
          "1": {
            start: { line: 3, column: 0 },
            end: { line: 3, column: 20 },
          },
          "2": {
            start: { line: 7, column: 0 },
            end: { line: 7, column: 20 },
          },
        },
        s: { "0": 1, "1": 0, "2": 1 },
      },
    };

    const result = calculateChangedLineCoverage(
      changedLines,
      coverageData,
      "/project"
    );
    // 行 1 覆盖, 行 3 未覆盖, 行 7 覆盖 → 2/3 = 67%
    expect(result.covered).toBe(2);
    expect(result.total).toBe(3);
    expect(result.percentage).toBe(67);
  });

  it("跳过测试文件", () => {
    const changedLines = new Map([
      ["src/foo.test.ts", [1, 2, 3]],
    ]);

    const result = calculateChangedLineCoverage(changedLines, {}, "/project");
    expect(result.total).toBe(0);
    expect(result.percentage).toBe(100);
  });
});

// ─── 门禁 1: checkFeatHasTests ───────────────────────────────────

describe("checkFeatHasTests", () => {
  it("非 feat PR 跳过检查", () => {
    const result = checkFeatHasTests(["fix"], ["src/index.ts"]);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("feat PR 有测试文件通过", () => {
    const result = checkFeatHasTests(
      ["feat"],
      ["src/index.ts", "tests/index.test.ts"]
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("feat PR 无测试文件失败", () => {
    const result = checkFeatHasTests(["feat"], ["src/index.ts"]);
    expect(result.passed).toBe(false);
  });

  it("feat PR 只有 .md 文件（无 allChangedFiles）仍失败", () => {
    const result = checkFeatHasTests(["feat"], ["README.md", "docs/guide.md"]);
    expect(result.passed).toBe(false);
  });

  it("feat PR allChangedFiles 无源码文件则跳过", () => {
    const result = checkFeatHasTests(
      ["feat"],
      ["README.md", "docs/guide.md"],
      ["README.md", "docs/guide.md"]
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("feat PR allChangedFiles 有源码文件但无测试则失败", () => {
    const result = checkFeatHasTests(
      ["feat"],
      ["src/index.ts"],
      ["src/index.ts"]
    );
    expect(result.passed).toBe(false);
  });

  it("feat PR 有修改的测试文件（非新增）通过，allChangedFiles 有源码和测试", () => {
    // 场景：测试文件是 modified（不在 addedFiles），但在 allChangedFiles
    const result = checkFeatHasTests(
      ["feat"],
      ["src/index.ts"], // addedFiles：只有源码，无新增测试
      ["src/index.ts", "tests/index.test.ts"] // allChangedFiles：源码 + 修改的测试
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
  });
});

// ─── 门禁 2: checkTestImportsSource ──────────────────────────────

describe("checkTestImportsSource", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-test2-"));
  });

  it("无新增测试文件跳过", () => {
    const result = checkTestImportsSource(
      ["src/index.ts"],
      ["src/index.ts"],
      tmpDir
    );
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("新测试 import 源码通过", () => {
    const testDir = path.join(tmpDir, "tests");
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "foo.test.ts"),
      `import { foo } from '../src/foo';\ndescribe('foo', () => { it('works', () => { expect(foo()).toBe(1); }); });`
    );
    fs.writeFileSync(
      path.join(srcDir, "foo.ts"),
      "export function foo() { return 1; }"
    );

    const result = checkTestImportsSource(
      ["tests/foo.test.ts", "src/foo.ts"],
      ["tests/foo.test.ts", "src/foo.ts"],
      tmpDir
    );
    expect(result.passed).toBe(true);
  });

  it("新测试不 import 源码失败", () => {
    const testDir = path.join(tmpDir, "tests");
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "orphan.test.ts"),
      `describe('orphan', () => { it('empty', () => {}); });`
    );

    const result = checkTestImportsSource(
      ["tests/orphan.test.ts"],
      ["tests/orphan.test.ts", "src/real.ts"],
      tmpDir
    );
    expect(result.passed).toBe(false);
    expect(result.files).toContain("tests/orphan.test.ts");
  });
});

// ─── 门禁 3: checkChangedLineCoverage ────────────────────────────

describe("checkChangedLineCoverage", () => {
  it("无覆盖率报告跳过", () => {
    const result = checkChangedLineCoverage(new Map(), null, "/project", 60);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("无源码变更跳过", () => {
    const result = checkChangedLineCoverage(new Map(), {}, "/project", 60);
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("覆盖率达标通过", () => {
    const changedLines = new Map([["src/foo.ts", [1, 2, 3]]]);
    const coverageData = {
      "/project/src/foo.ts": {
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 30 },
          },
          "1": {
            start: { line: 2, column: 0 },
            end: { line: 2, column: 30 },
          },
          "2": {
            start: { line: 3, column: 0 },
            end: { line: 3, column: 30 },
          },
        },
        s: { "0": 1, "1": 1, "2": 0 },
      },
    };

    const result = checkChangedLineCoverage(
      changedLines,
      coverageData,
      "/project",
      60
    );
    // 2/3 = 67% ≥ 60%
    expect(result.passed).toBe(true);
    expect(result.coverage?.percentage).toBe(67);
  });

  it("覆盖率不达标失败", () => {
    const changedLines = new Map([["src/foo.ts", [1, 2, 3, 4, 5]]]);
    const coverageData = {
      "/project/src/foo.ts": {
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 30 },
          },
        },
        s: { "0": 1 },
      },
    };

    const result = checkChangedLineCoverage(
      changedLines,
      coverageData,
      "/project",
      60
    );
    // 1/5 = 20% < 60%
    expect(result.passed).toBe(false);
    expect(result.coverage?.percentage).toBe(20);
  });

  it("只检查源码行，跳过测试文件变更", () => {
    const changedLines = new Map([
      ["src/foo.test.ts", [1, 2, 3]],
      ["src/foo.ts", [1]],
    ]);
    const coverageData = {
      "/project/src/foo.ts": {
        statementMap: {
          "0": {
            start: { line: 1, column: 0 },
            end: { line: 1, column: 30 },
          },
        },
        s: { "0": 1 },
      },
    };

    const result = checkChangedLineCoverage(
      changedLines,
      coverageData,
      "/project",
      60
    );
    // 只算 src/foo.ts: 1/1 = 100%
    expect(result.passed).toBe(true);
    expect(result.coverage?.percentage).toBe(100);
  });
});
