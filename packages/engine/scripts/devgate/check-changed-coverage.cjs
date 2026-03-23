#!/usr/bin/env node
/**
 * check-changed-coverage.cjs — 变更行覆盖率硬门禁
 *
 * 三个确定性门禁（零 LLM 成本）：
 *   门禁 1: feat: PR 必须有新增测试文件
 *   门禁 2: 新测试必须 import 本 PR 修改的源码
 *   门禁 3: 变更行覆盖率 ≥ 60%（feat / fix / refactor PR 均适用）
 *
 * 用法：
 *   node check-changed-coverage.cjs                    # 自动检测 base branch
 *   node check-changed-coverage.cjs --base origin/main # 指定 base
 *   node check-changed-coverage.cjs --coverage-dir ./coverage  # 指定覆盖率目录
 *
 * Exit codes:
 *   0 = 通过
 *   1 = 门禁失败
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const COVERAGE_THRESHOLD = 60; // 变更行覆盖率阈值 (%)

// ─── 工具函数 ─────────────────────────────────────────────────────

/**
 * 获取 PR 的 commit 类型（feat/fix/docs/chore 等）
 * 返回所有 commit message 的前缀集合
 */
function getCommitTypes(baseBranch) {
  try {
    const log = execSync(`git log ${baseBranch}..HEAD --pretty=format:"%s"`, {
      encoding: "utf-8",
    }).trim();
    if (!log) return [];
    return log
      .split("\n")
      .map((msg) => {
        const match = msg.replace(/^"/, "").match(/^(\w+)[\s(!:]/);
        return match ? match[1].toLowerCase() : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 判断是否为 feat PR（至少一个 commit 是 feat:）
 */
function isFeatPR(commitTypes) {
  return commitTypes.includes("feat");
}

/**
 * 判断是否为 fix / refactor PR（需要覆盖率检查，但不强制新增测试文件）
 */
function isFixOrRefactorPR(commitTypes) {
  return commitTypes.includes("fix") || commitTypes.includes("refactor");
}

/**
 * 获取 PR 变更文件列表
 * @returns {{ added: string[], modified: string[], all: string[] }}
 */
function getChangedFiles(baseBranch) {
  try {
    const addedRaw = execSync(
      `git diff --name-only --diff-filter=A ${baseBranch}...HEAD`,
      { encoding: "utf-8" }
    ).trim();
    const modifiedRaw = execSync(
      `git diff --name-only --diff-filter=M ${baseBranch}...HEAD`,
      { encoding: "utf-8" }
    ).trim();

    const added = addedRaw ? addedRaw.split("\n") : [];
    const modified = modifiedRaw ? modifiedRaw.split("\n") : [];
    return { added, modified, all: [...added, ...modified] };
  } catch {
    return { added: [], modified: [], all: [] };
  }
}

/**
 * 过滤出源码文件（排除测试、配置、文档）
 */
function filterSourceFiles(files) {
  return files.filter((f) => {
    if (!/\.(ts|js|mjs|cjs|sh)$/.test(f)) return false;
    if (/\.(test|spec)\.(ts|js|mjs|cjs)$/.test(f)) return false;
    if (/(__tests__|__mocks__)\//.test(f)) return false;
    if (/(vitest|jest)\.config\.(ts|js)$/.test(f)) return false;
    if (/node_modules\//.test(f)) return false;
    return true;
  });
}

/**
 * 过滤出新增的测试文件
 */
function filterNewTestFiles(addedFiles) {
  return addedFiles.filter((f) =>
    /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(f)
  );
}

/**
 * 检查测试文件是否 import 了指定的源码文件
 * @param {string} testFile - 测试文件路径
 * @param {string[]} sourceFiles - 源码文件列表
 * @param {string} projectRoot - 项目根目录
 * @returns {boolean}
 */
function testImportsSourceFile(testFile, sourceFiles, projectRoot) {
  try {
    const content = fs.readFileSync(path.join(projectRoot, testFile), "utf-8");

    // 提取 import/require 路径
    const importPaths = [];
    // ESM: import ... from '...'
    const esmRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
    let m;
    while ((m = esmRegex.exec(content)) !== null) {
      importPaths.push(m[1]);
    }
    // CJS: require('...')
    const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = cjsRegex.exec(content)) !== null) {
      importPaths.push(m[1]);
    }
    // resolve(__dirname, '...') — shell/binary file references in tests
    const resolveRegex = /resolve\s*\(__dirname,\s*['"]([^'"]+)['"]/g;
    while ((m = resolveRegex.exec(content)) !== null) {
      importPaths.push(m[1]);
    }

    // 检查是否有任何 import 路径指向变更的源码文件
    const testDir = path.dirname(testFile);
    for (const imp of importPaths) {
      if (imp.startsWith(".")) {
        // 相对路径 import
        const resolved = path.normalize(path.join(testDir, imp));
        for (const src of sourceFiles) {
          const srcNoExt = src.replace(/\.(ts|js|mjs|cjs|sh)$/, "");
          const resolvedNoExt = resolved.replace(/\.(ts|js|mjs|cjs|sh)$/, "");
          if (
            srcNoExt === resolvedNoExt ||
            src === resolved ||
            resolved.endsWith(path.basename(srcNoExt))
          ) {
            return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 获取变更行号（从 git diff unified=0 提取）
 * @returns {Map<string, number[]>} 文件路径 → 变更行号数组
 */
function getChangedLines(baseBranch) {
  const result = new Map();
  try {
    const diff = execSync(
      `git diff -U0 ${baseBranch}...HEAD -- '*.ts' '*.js' '*.mjs' '*.cjs'`,
      { encoding: "utf-8" }
    );

    let currentFile = null;
    for (const line of diff.split("\n")) {
      // +++ b/path/to/file.ts
      const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
      if (fileMatch) {
        currentFile = fileMatch[1];
        if (!result.has(currentFile)) {
          result.set(currentFile, []);
        }
        continue;
      }

      // @@ -old,count +new,count @@
      if (currentFile && line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
          const startLine = parseInt(hunkMatch[1], 10);
          const lineCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1;
          const lines = result.get(currentFile);
          for (let i = 0; i < lineCount; i++) {
            lines.push(startLine + i);
          }
        }
      }
    }
  } catch {
    // git diff failed
  }
  return result;
}

/**
 * 读取 Istanbul JSON 覆盖率报告
 * @param {string} coverageDir - coverage 目录
 * @returns {object|null} 覆盖率数据
 */
function readCoverageReport(coverageDir) {
  const jsonPath = path.join(coverageDir, "coverage-final.json");
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * 检查某个文件中某一行是否被覆盖
 * @param {object} fileCoverage - Istanbul 文件覆盖率对象
 * @param {number} lineNum - 行号
 * @returns {boolean}
 */
function isLineCovered(fileCoverage, lineNum) {
  if (!fileCoverage || !fileCoverage.statementMap || !fileCoverage.s) {
    return false;
  }

  // 查找覆盖该行的所有 statement
  for (const [id, loc] of Object.entries(fileCoverage.statementMap)) {
    if (lineNum >= loc.start.line && lineNum <= loc.end.line) {
      if (fileCoverage.s[id] > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 计算变更行覆盖率
 * @param {Map<string, number[]>} changedLines - 文件→变更行号
 * @param {object} coverageData - Istanbul 覆盖率报告
 * @param {string} projectRoot - 项目根目录
 * @returns {{ covered: number, total: number, percentage: number, details: object[] }}
 */
function calculateChangedLineCoverage(changedLines, coverageData, projectRoot) {
  let totalChanged = 0;
  let totalCovered = 0;
  const details = [];

  for (const [file, lines] of changedLines.entries()) {
    // 跳过测试文件和配置文件
    if (/\.(test|spec)\.(ts|js)$/.test(file)) continue;
    if (/(vitest|jest)\.config/.test(file)) continue;
    if (/(__tests__|__mocks__)\//.test(file)) continue;

    const sourceLines = lines.filter((l) => l > 0);
    if (sourceLines.length === 0) continue;

    // Istanbul 用绝对路径作 key
    const absPath = path.resolve(projectRoot, file);
    const fileCov = coverageData[absPath] || coverageData[file];

    let fileCovered = 0;
    for (const lineNum of sourceLines) {
      if (fileCov && isLineCovered(fileCov, lineNum)) {
        fileCovered++;
      }
    }

    totalChanged += sourceLines.length;
    totalCovered += fileCovered;

    details.push({
      file,
      total: sourceLines.length,
      covered: fileCovered,
      percentage:
        sourceLines.length > 0
          ? Math.round((fileCovered / sourceLines.length) * 100)
          : 100,
    });
  }

  return {
    covered: totalCovered,
    total: totalChanged,
    percentage:
      totalChanged > 0 ? Math.round((totalCovered / totalChanged) * 100) : 100,
    details,
  };
}

// ─── 门禁检查 ─────────────────────────────────────────────────────

/**
 * 门禁 1: feat PR 必须有新增测试文件
 */
function checkFeatHasTests(commitTypes, addedFiles, allChangedFiles) {
  if (!isFeatPR(commitTypes)) {
    return { passed: true, skipped: true, reason: "非 feat PR，跳过" };
  }

  // 无源码文件变更（如纯 .md 文档/配置更新）→ 跳过测试要求
  if (allChangedFiles != null) {
    const sourceFiles = filterSourceFiles(allChangedFiles);
    if (sourceFiles.length === 0) {
      return { passed: true, skipped: true, reason: "无源码文件变更，跳过测试要求" };
    }
  }

  // 优先检查新增测试，其次接受修改的测试文件（含新增测试用例的场景）
  const newTests = filterNewTestFiles(addedFiles);
  const allTests = allChangedFiles != null ? filterNewTestFiles(allChangedFiles) : newTests;
  if (newTests.length === 0 && allTests.length === 0) {
    return {
      passed: false,
      skipped: false,
      reason:
        "feat: PR 必须包含新增的测试文件（.test.ts/.test.js）",
      details: "请为新功能编写对应的测试",
    };
  }

  const testFiles = newTests.length > 0 ? newTests : allTests;
  return {
    passed: true,
    skipped: false,
    reason: `找到 ${testFiles.length} 个测试文件（新增或修改）`,
    files: testFiles,
  };
}

/**
 * 门禁 2: 新测试必须 import 新代码
 */
function checkTestImportsSource(addedFiles, allChangedFiles, projectRoot) {
  const newTests = filterNewTestFiles(addedFiles);
  if (newTests.length === 0) {
    return { passed: true, skipped: true, reason: "无新增测试文件，跳过" };
  }

  const sourceFiles = filterSourceFiles(allChangedFiles);
  if (sourceFiles.length === 0) {
    return {
      passed: true,
      skipped: true,
      reason: "无源码文件变更，跳过",
    };
  }

  const orphanTests = [];
  for (const testFile of newTests) {
    if (!testImportsSourceFile(testFile, sourceFiles, projectRoot)) {
      orphanTests.push(testFile);
    }
  }

  if (orphanTests.length > 0) {
    return {
      passed: false,
      skipped: false,
      reason: `${orphanTests.length} 个新测试未 import 本 PR 修改的源码`,
      files: orphanTests,
    };
  }

  return {
    passed: true,
    skipped: false,
    reason: `${newTests.length} 个新测试全部引用了变更源码`,
  };
}

/**
 * 门禁 3: 变更行覆盖率
 */
function checkChangedLineCoverage(
  changedLines,
  coverageData,
  projectRoot,
  threshold
) {
  if (!coverageData) {
    return {
      passed: true,
      skipped: true,
      reason: "无覆盖率报告（coverage-final.json），跳过",
    };
  }

  // 只检查源码文件的变更行
  const sourceChangedLines = new Map();
  for (const [file, lines] of changedLines.entries()) {
    if (/\.(test|spec)\.(ts|js)$/.test(file)) continue;
    if (/(vitest|jest)\.config/.test(file)) continue;
    if (/(__tests__|__mocks__)\//.test(file)) continue;
    if (!/\.(ts|js|mjs|cjs)$/.test(file)) continue;
    sourceChangedLines.set(file, lines);
  }

  if (sourceChangedLines.size === 0) {
    return {
      passed: true,
      skipped: true,
      reason: "无源码行变更，跳过覆盖率检查",
    };
  }

  const result = calculateChangedLineCoverage(
    sourceChangedLines,
    coverageData,
    projectRoot
  );

  if (result.percentage < threshold) {
    return {
      passed: false,
      skipped: false,
      reason: `变更行覆盖率 ${result.percentage}% < 阈值 ${threshold}%`,
      coverage: result,
    };
  }

  return {
    passed: true,
    skipped: false,
    reason: `变更行覆盖率 ${result.percentage}% ≥ 阈值 ${threshold}%`,
    coverage: result,
  };
}

// ─── 主函数 ───────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let baseBranch = "origin/main";
  let coverageDir = null;
  let projectRoot = process.cwd();

  // 解析参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base" && args[i + 1]) {
      baseBranch = args[++i];
    } else if (args[i] === "--coverage-dir" && args[i + 1]) {
      coverageDir = args[++i];
    } else if (args[i] === "--project-root" && args[i + 1]) {
      projectRoot = args[++i];
    }
  }

  // 如果未指定覆盖率目录，自动检测
  if (!coverageDir) {
    // 在 engine 目录中查找
    const engineCov = path.join(projectRoot, "packages/engine/coverage");
    const localCov = path.join(projectRoot, "coverage");
    if (fs.existsSync(engineCov)) coverageDir = engineCov;
    else if (fs.existsSync(localCov)) coverageDir = localCov;
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  变更行覆盖率硬门禁");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  // 收集数据
  const commitTypes = getCommitTypes(baseBranch);
  const { added, all } = getChangedFiles(baseBranch);
  const changedLines = getChangedLines(baseBranch);
  const coverageData = coverageDir ? readCoverageReport(coverageDir) : null;

  let hasFailure = false;

  // ── 门禁 1: feat 必须有测试 ──
  console.log("  门禁 1: feat PR 必须有新增测试文件");
  const gate1 = checkFeatHasTests(commitTypes, added, all);
  if (gate1.skipped) {
    console.log(`  ${YELLOW}⏭️${RESET}  ${gate1.reason}`);
  } else if (gate1.passed) {
    console.log(`  ${GREEN}✅${RESET} ${gate1.reason}`);
    if (gate1.files) {
      gate1.files.forEach((f) => console.log(`     + ${f}`));
    }
  } else {
    console.log(`  ${RED}❌${RESET} ${gate1.reason}`);
    if (gate1.details) console.log(`     ${gate1.details}`);
    hasFailure = true;
  }
  console.log("");

  // ── 门禁 2: 测试 import 源码 ──
  console.log("  门禁 2: 新测试必须 import 本 PR 修改的源码");
  const gate2 = checkTestImportsSource(added, all, projectRoot);
  if (gate2.skipped) {
    console.log(`  ${YELLOW}⏭️${RESET}  ${gate2.reason}`);
  } else if (gate2.passed) {
    console.log(`  ${GREEN}✅${RESET} ${gate2.reason}`);
  } else {
    console.log(`  ${RED}❌${RESET} ${gate2.reason}`);
    if (gate2.files) {
      gate2.files.forEach((f) => console.log(`     - ${f}`));
    }
    hasFailure = true;
  }
  console.log("");

  // ── 门禁 3: 变更行覆盖率（feat / fix / refactor 均强制）──
  const isFix = isFixOrRefactorPR(commitTypes);
  if (isFix) {
    console.log(`  门禁 3: 变更行覆盖率 ≥ ${COVERAGE_THRESHOLD}% [fix/refactor PR 强制]`);
  } else {
    console.log(`  门禁 3: 变更行覆盖率 ≥ ${COVERAGE_THRESHOLD}%`);
  }
  const gate3CoverageData = (isFix && !coverageData) ? "__missing__" : coverageData;
  const gate3 = gate3CoverageData === "__missing__"
    ? { passed: false, skipped: false, reason: "fix/refactor PR 必须有覆盖率报告（请确认 vitest --coverage 已运行）", coverage: { covered: 0, total: 0 } }
    : checkChangedLineCoverage(changedLines, coverageData, projectRoot, COVERAGE_THRESHOLD);
  if (gate3.skipped) {
    console.log(`  ${YELLOW}⏭️${RESET}  ${gate3.reason}`);
  } else if (gate3.passed) {
    console.log(
      `  ${GREEN}✅${RESET} ${gate3.reason} (${gate3.coverage.covered}/${gate3.coverage.total} 行)`
    );
    if (gate3.coverage.details) {
      gate3.coverage.details.forEach((d) =>
        console.log(`     ${d.percentage}% ${d.file} (${d.covered}/${d.total})`)
      );
    }
  } else {
    console.log(
      `  ${RED}❌${RESET} ${gate3.reason} (${gate3.coverage.covered}/${gate3.coverage.total} 行)`
    );
    if (gate3.coverage.details) {
      gate3.coverage.details.forEach((d) => {
        const icon = d.percentage >= COVERAGE_THRESHOLD ? "✅" : "❌";
        console.log(
          `     ${icon} ${d.percentage}% ${d.file} (${d.covered}/${d.total})`
        );
      });
    }
    hasFailure = true;
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (hasFailure) {
    console.log(`  ${RED}❌ 变更行覆盖率门禁失败${RESET}`);
  } else {
    console.log(`  ${GREEN}✅ 变更行覆盖率门禁通过${RESET}`);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");

  process.exit(hasFailure ? 1 : 0);
}

// ─── 导出（供测试使用）──────────────────────────────────────────

module.exports = {
  getCommitTypes,
  isFeatPR,
  isFixOrRefactorPR,
  getChangedFiles,
  filterSourceFiles,
  filterNewTestFiles,
  testImportsSourceFile,
  getChangedLines,
  readCoverageReport,
  isLineCovered,
  calculateChangedLineCoverage,
  checkFeatHasTests,
  checkTestImportsSource,
  checkChangedLineCoverage,
  COVERAGE_THRESHOLD,
};

if (require.main === module) {
  main();
}
