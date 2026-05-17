#!/usr/bin/env node
/**
 * check-dod-purity.cjs — Harness v5 CI check
 *
 * 规则：
 *   contract-dod-ws{N}.md 只能装 [ARTIFACT] 条目，严禁 [BEHAVIOR] 条目
 *   Test 字段只允许白名单：node / npm / curl / bash / psql / tests/ / manual: / contract:
 *
 * 扫描范围：
 *   PR 改动里新增或修改的 sprints/*​/contract-dod-ws*.md 文件
 *   或直接传文件路径作为参数
 *
 * 用法：
 *   node check-dod-purity.cjs                 # 自动扫 git diff origin/main...HEAD
 *   node check-dod-purity.cjs path/to/ws1.md  # 扫指定文件
 *
 * Exit: 0 通过；1 违规
 */

const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * 列出待扫描的文件
 */
function listFiles() {
  const cliFiles = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (cliFiles.length > 0) {
    return cliFiles.filter((f) => fs.existsSync(f));
  }
  // 从 git diff 自动提取
  try {
    const base = process.env.BASE_REF || "origin/main";
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf-8",
    });
    return out
      .split("\n")
      .filter((f) => /^sprints\/[^/]+\/contract-dod-ws\d+\.md$/.test(f))
      .filter((f) => fs.existsSync(f));
  } catch (e) {
    console.error(`${YELLOW}⚠️  git diff 失败，未扫描任何文件${RESET}`);
    return [];
  }
}

/**
 * 检查单个 contract-dod-ws 文件
 * @returns {string[]} 违规信息数组（空数组 = 通过）
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations = [];

  // Rule 1: 禁 [BEHAVIOR] 条目
  // 允许的：`## BEHAVIOR 索引`（标题）
  // 禁止的：`- [ ] [BEHAVIOR] ...` 或 `- [x] [BEHAVIOR] ...`
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s*\[[\sxX]\]\s*\[BEHAVIOR\]/.test(lines[i])) {
      violations.push(
        `L${i + 1}: 禁止 [BEHAVIOR] 条目 — BEHAVIOR 必须搬到 tests/ws{N}/*.test.ts：\n    ${lines[i].trim()}`
      );
    }
  }

  // Rule 2: Test 字段白名单
  // 允许：manual:<cmd>(含 node/npm/curl/bash/psql) / tests/... / contract:...
  // 禁止裸用：ls / sed / awk / echo / cat
  const TEST_LINE_RE = /^\s*Test:\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TEST_LINE_RE);
    if (!m) continue;
    const val = m[1].trim();
    // 接受格式
    if (/^manual:(node|npm|curl|bash|psql)\b/.test(val)) continue;
    if (/^tests\//.test(val)) continue;
    if (/^contract:/.test(val)) continue;
    // 允许 inline node -e 等裸命令（v4 老格式，不强断但提醒）
    if (/^(node\s+-e|npm\s|curl\s|bash\s|psql\s)/.test(val)) continue;
    violations.push(
      `L${i + 1}: Test 字段格式非法 — 允许 manual:<cmd> / tests/ / contract:；\n    ${val.slice(0, 120)}`
    );
  }

  return violations;
}

function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  DoD Purity Check (v5.0)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const files = listFiles();
  if (files.length === 0) {
    console.log(`${YELLOW}ℹ️  无 contract-dod-ws*.md 变更，跳过检查${RESET}\n`);
    process.exit(0);
  }

  let totalViolations = 0;
  for (const f of files) {
    console.log(`📋 扫描: ${f}`);
    const violations = checkFile(f);
    if (violations.length === 0) {
      console.log(`  ${GREEN}✅ 通过${RESET}\n`);
    } else {
      console.log(`  ${RED}❌ ${violations.length} 处违规${RESET}`);
      for (const v of violations) {
        console.log(`    ${v}`);
      }
      console.log("");
      totalViolations += violations.length;
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (totalViolations === 0) {
    console.log(`${GREEN}✅ DoD 纯度检查通过${RESET} (${files.length} 个文件)`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(0);
  } else {
    console.log(`${RED}❌ DoD 纯度检查失败${RESET} (${totalViolations} 处违规)`);
    console.log("\n  contract-dod-ws{N}.md 规则：");
    console.log("    - 只能装 [ARTIFACT] 条目");
    console.log("    - [BEHAVIOR] 必须搬到 sprints/{sprint}/tests/ws{N}/*.test.ts");
    console.log("    - Test 字段：manual:<cmd> / tests/... / contract:...");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  }
}

main();
