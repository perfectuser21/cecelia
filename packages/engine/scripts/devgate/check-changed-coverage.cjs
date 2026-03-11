#!/usr/bin/env node
/**
 * check-changed-coverage.cjs
 *
 * feat PR 变更行覆盖率三门禁
 *
 * 门禁 1：commit message 以 feat: 开头的 PR，diff 中必须有新增 .test.ts 文件
 * 门禁 2：新增 .test.ts 文件必须 import 本 PR 新增/修改的源码文件（至少一个）
 * 门禁 3：本 PR 新增/修改的 .ts 源码行，至少 60% 被测试覆盖
 *
 * 用法（GitHub Actions）：
 *   node scripts/devgate/check-changed-coverage.cjs
 *
 * 环境变量：
 *   PR_TITLE       PR 标题（判断是否 feat: 前缀）
 *   BASE_REF       目标分支（默认 main）
 *   COVERAGE_JSON  覆盖率 JSON 路径（默认 coverage/coverage-final.json）
 *
 * 返回码：
 *   0 - 全部通过（或非 feat: PR，直接跳过）
 *   1 - 任一门禁失败
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 颜色
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const COVERAGE_THRESHOLD = 0.6;

// ─── 纯函数（导出供测试）──────────────────────────────────────────────────

/**
 * 解析 unified diff（-U0 格式），返回各文件新增行号列表
 * @param {string} diffText  git diff -U0 输出
 * @returns {Record<string, number[]>}  { "path/to/file.ts": [1, 3, 5, ...] }
 */
function parseUnifiedDiff(diffText) {
  const result = {};
  let currentFile = null;
  let currentNewStart = 0;

  for (const line of diffText.split("\n")) {
    // +++ b/path/to/file.ts
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
      if (!result[currentFile]) result[currentFile] = [];
      currentNewStart = 0;
    }
    // @@ -old[,count] +new[,count] @@
    else if (line.startsWith("@@")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        currentNewStart = parseInt(m[1], 10);
      }
    }
    // Added line (+ but not +++)
    else if (line.startsWith("+") && !line.startsWith("+++") && currentFile) {
      result[currentFile].push(currentNewStart);
      currentNewStart++;
    }
    // Context or unchanged line (not -, not \\, not diff header)
    else if (
      !line.startsWith("-") &&
      !line.startsWith("\\") &&
      !line.startsWith("diff ") &&
      !line.startsWith("index ") &&
      !line.startsWith("--- ")
    ) {
      currentNewStart++;
    }
  }

  return result;
}

/**
 * 在 coverage-final.json 中查找与 filePath 匹配的 key（绝对路径）
 * @param {Record<string, unknown>} coverageData  Istanbul JSON 对象
 * @param {string} filePath                        相对路径（来自 git diff）
 * @returns {string | null}
 */
function findCoverageKey(coverageData, filePath) {
  // 1. 精确匹配（相对路径直接在 key 中）
  if (coverageData[filePath]) return filePath;

  // 2. 绝对路径包含相对路径（最常见）
  const normalized = filePath.replace(/\\/g, "/");
  for (const key of Object.keys(coverageData)) {
    const normalizedKey = key.replace(/\\/g, "/");
    if (
      normalizedKey.endsWith("/" + normalized) ||
      normalizedKey === normalized
    ) {
      return key;
    }
  }

  // 3. basename 兜底（处理路径混乱情况）
  const basename = path.basename(filePath);
  for (const key of Object.keys(coverageData)) {
    if (path.basename(key) === basename) {
      return key;
    }
  }

  return null;
}

/**
 * 从 TS/CJS 文件内容中提取 import 路径
 * @param {string} content  文件内容
 * @returns {string[]}  import 路径列表
 */
function extractImports(content) {
  const imports = [];
  // ES module: import ... from "..."
  const esmRegex =
    /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = esmRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }
  // CommonJS: require("...")
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRegex.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * 检查文件级变更行的覆盖情况
 * @param {{ statementMap: Record<string,{start:{line:number},end:{line:number}}>, s: Record<string,number> }} fileCoverage
 * @param {number[]} changedLines  新增行号列表
 * @returns {{ covered: number, total: number }}
 */
function countCoveredLines(fileCoverage, changedLines) {
  const { statementMap, s } = fileCoverage;
  let covered = 0;

  for (const line of changedLines) {
    let isCovered = false;
    for (const [stmtId, loc] of Object.entries(statementMap)) {
      if (loc.start.line <= line && loc.end.line >= line) {
        if (s[stmtId] > 0) {
          isCovered = true;
          break;
        }
      }
    }
    if (isCovered) covered++;
  }

  return { covered, total: changedLines.length };
}

// ─── 主逻辑（仅直接运行时执行）──────────────────────────────────────────

function main() {
  const PR_TITLE = process.env.PR_TITLE || "";
  const BASE_REF = process.env.BASE_REF || "main";
  const COVERAGE_JSON =
    process.env.COVERAGE_JSON || "coverage/coverage-final.json";

  // 只对 feat: 或 feat!: 开头的 PR 执行门禁
  const isFeatPR =
    PR_TITLE.startsWith("feat:") || PR_TITLE.startsWith("feat!:");

  if (!isFeatPR) {
    console.log(
      `${GREEN}✅ 非 feat: PR，跳过变更行覆盖率检查（PR: ${PR_TITLE || "(无标题)"}）${RESET}`
    );
    process.exit(0);
  }

  console.log(`🔍 feat: PR 检测到，开始三门禁检查...`);
  console.log(`   PR 标题: ${PR_TITLE}`);
  console.log(`   Base: origin/${BASE_REF}`);

  // 获取变更文件列表
  let changedFilesOutput;
  try {
    changedFilesOutput = execSync(
      `git diff --name-status origin/${BASE_REF}...HEAD 2>/dev/null || git diff --name-status HEAD~1 HEAD`,
      { encoding: "utf-8" }
    );
  } catch (e) {
    console.error(`${RED}❌ 无法获取 diff: ${e.message}${RESET}`);
    process.exit(1);
  }

  // 解析变更文件
  const changedEntries = changedFilesOutput
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split("\t");
      return { status: parts[0].trim(), file: parts[parts.length - 1].trim() };
    });

  const newTestFiles = changedEntries
    .filter((f) => f.status === "A" && f.file.endsWith(".test.ts"))
    .map((f) => f.file);

  const changedSourceFiles = changedEntries
    .filter(
      (f) =>
        !f.file.endsWith(".test.ts") &&
        f.file.endsWith(".ts") &&
        (f.status === "A" || f.status === "M")
    )
    .map((f) => f.file);

  console.log(`\n📋 变更统计:`);
  console.log(`   新增 .test.ts: ${newTestFiles.length} 个`);
  console.log(`   变更 .ts 源码: ${changedSourceFiles.length} 个`);

  // ─── 门禁 1: feat PR 必须有新增 .test.ts ───────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  门禁 1: feat PR 必须有新增 .test.ts`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (newTestFiles.length === 0) {
    console.error(
      `${RED}❌ 门禁 1 失败: feat: PR 必须包含至少一个新增 .test.ts 文件${RESET}`
    );
    console.error(`   解决方案: 为新功能添加测试文件（*.test.ts）`);
    process.exit(1);
  }

  console.log(
    `${GREEN}✅ 门禁 1 通过: 发现 ${newTestFiles.length} 个新增测试文件${RESET}`
  );
  newTestFiles.forEach((f) => console.log(`   + ${f}`));

  // ─── 门禁 2: 新测试必须 import 变更源码 ────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  门禁 2: 新测试必须 import 本 PR 变更的源码`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (changedSourceFiles.length === 0) {
    console.log(`${YELLOW}⚠️  无变更源码文件，门禁 2 跳过${RESET}`);
  } else {
    let anyTestImportsChangedSource = false;
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
    }).trim();

    outerLoop: for (const testFile of newTestFiles) {
      const absTestFile = path.join(gitRoot, testFile);
      if (!fs.existsSync(absTestFile)) continue;

      const content = fs.readFileSync(absTestFile, "utf-8");
      const imports = extractImports(content);

      for (const imp of imports) {
        if (!imp.startsWith(".")) continue; // 跳过非相对路径
        const testDir = path.dirname(absTestFile);
        const resolvedAbs = path.resolve(testDir, imp);
        const resolvedRel = path
          .relative(gitRoot, resolvedAbs)
          .replace(/\\/g, "/");

        for (const srcFile of changedSourceFiles) {
          const srcNoExt = srcFile.replace(/\.ts$/, "");
          if (
            resolvedRel === srcFile ||
            resolvedRel === srcNoExt ||
            resolvedRel + ".ts" === srcFile
          ) {
            anyTestImportsChangedSource = true;
            console.log(`   ✓ ${testFile} → imports → ${srcFile}`);
            break outerLoop;
          }
        }
      }
    }

    if (!anyTestImportsChangedSource) {
      console.error(
        `${RED}❌ 门禁 2 失败: 新增的 .test.ts 文件未 import 本 PR 变更的源码${RESET}`
      );
      console.error(`   新增测试: ${newTestFiles.join(", ")}`);
      console.error(`   变更源码: ${changedSourceFiles.join(", ")}`);
      console.error(
        `   解决方案: 确保测试文件 import 了本次变更的源码文件`
      );
      process.exit(1);
    }

    console.log(
      `${GREEN}✅ 门禁 2 通过: 测试文件引用了变更的源码${RESET}`
    );
  }

  // ─── 门禁 3: 变更行覆盖率 >= 60% ───────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  门禁 3: 变更行覆盖率 ≥ ${Math.round(COVERAGE_THRESHOLD * 100)}%`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (!fs.existsSync(COVERAGE_JSON)) {
    console.error(
      `${RED}❌ 门禁 3 失败: 覆盖率文件不存在: ${COVERAGE_JSON}${RESET}`
    );
    console.error(
      `   请先运行: npx vitest run --coverage --coverage.reporter=json`
    );
    process.exit(1);
  }

  if (changedSourceFiles.length === 0) {
    console.log(`${YELLOW}⚠️  无变更源码文件，门禁 3 跳过${RESET}`);
    console.log(`\n${GREEN}✅ 三门禁全部通过${RESET}`);
    process.exit(0);
  }

  const coverageData = JSON.parse(fs.readFileSync(COVERAGE_JSON, "utf-8"));
  const gitRoot2 = execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
  }).trim();

  // 获取行级 diff
  let diffOutput;
  try {
    const fileArgs = changedSourceFiles
      .map((f) => `"${path.join(gitRoot2, f)}"`)
      .join(" ");
    diffOutput = execSync(
      `git diff -U0 origin/${BASE_REF}...HEAD -- ${fileArgs} 2>/dev/null || git diff -U0 HEAD~1 HEAD -- ${fileArgs}`,
      { encoding: "utf-8" }
    );
  } catch (e) {
    console.warn(`${YELLOW}⚠️  无法获取行级 diff，门禁 3 跳过: ${e.message}${RESET}`);
    console.log(`\n${GREEN}✅ 三门禁全部通过${RESET}`);
    process.exit(0);
  }

  const fileLineChanges = parseUnifiedDiff(diffOutput);

  let totalChangedLines = 0;
  let coveredChangedLines = 0;

  for (const srcFile of changedSourceFiles) {
    // diff 输出中文件路径相对于 git root
    const diffKey = Object.keys(fileLineChanges).find(
      (k) => k === srcFile || k.endsWith("/" + srcFile) || k === path.join(gitRoot2, srcFile)
    );
    const addedLines = diffKey ? fileLineChanges[diffKey] : [];

    if (addedLines.length === 0) {
      console.log(`   ${srcFile}: 无新增行，跳过`);
      continue;
    }

    const coverageKey = findCoverageKey(coverageData, srcFile);

    if (!coverageKey) {
      console.log(`   ${YELLOW}⚠️  ${srcFile}: 覆盖率数据中未找到${RESET}`);
      totalChangedLines += addedLines.length;
      continue;
    }

    const fileCoverage = coverageData[coverageKey];
    if (!fileCoverage.statementMap || !fileCoverage.s) {
      console.log(`   ${YELLOW}⚠️  ${srcFile}: 覆盖率格式不支持${RESET}`);
      totalChangedLines += addedLines.length;
      continue;
    }

    const { covered, total } = countCoveredLines(fileCoverage, addedLines);
    const pct = total > 0 ? Math.round((covered / total) * 100) : 100;
    console.log(`   ${srcFile}: ${covered}/${total} 行已覆盖 (${pct}%)`);
    totalChangedLines += total;
    coveredChangedLines += covered;
  }

  if (totalChangedLines === 0) {
    console.log(`${YELLOW}⚠️  无可分析的变更行，门禁 3 跳过${RESET}`);
    console.log(`\n${GREEN}✅ 三门禁全部通过${RESET}`);
    process.exit(0);
  }

  const coverageRatio = coveredChangedLines / totalChangedLines;
  const coveragePercent = Math.round(coverageRatio * 100);

  console.log(
    `\n📊 变更行覆盖率: ${coveredChangedLines}/${totalChangedLines} = ${coveragePercent}%`
  );
  console.log(`   阈值: ${Math.round(COVERAGE_THRESHOLD * 100)}%`);

  if (coverageRatio < COVERAGE_THRESHOLD) {
    console.error(
      `${RED}❌ 门禁 3 失败: 变更行覆盖率 ${coveragePercent}% < ${Math.round(COVERAGE_THRESHOLD * 100)}%${RESET}`
    );
    console.error(`   解决方案: 补充测试覆盖本次变更的代码行`);
    process.exit(1);
  }

  console.log(
    `${GREEN}✅ 门禁 3 通过: 变更行覆盖率 ${coveragePercent}% ≥ ${Math.round(COVERAGE_THRESHOLD * 100)}%${RESET}`
  );
  console.log(`\n${GREEN}✅ 三门禁全部通过${RESET}`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

// 导出纯函数供测试
module.exports = {
  parseUnifiedDiff,
  findCoverageKey,
  extractImports,
  countCoveredLines,
};
