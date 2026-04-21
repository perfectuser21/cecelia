#!/usr/bin/env node
/**
 * check-test-coverage.cjs — Harness v5 CI check
 *
 * 规则：
 *   合同 `## Test Contract` 表声明的每个 Test File 必须在 PR diff 里存在
 *   合同的 BEHAVIOR 覆盖项名必须能在对应 .test.ts 里找到对应的 it()
 *
 * 扫描范围：
 *   PR 里新增的 contract-draft.md 或 sprint-contract.md
 *
 * 用法：
 *   node check-test-coverage.cjs              # 自动扫 git diff origin/main...HEAD
 *   node check-test-coverage.cjs <合同路径>    # 扫指定合同文件
 *
 * Exit: 0 通过；1 违规；0 跳过（无合同变更）
 */

const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function listContracts() {
  const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (cliArgs.length > 0) return cliArgs.filter((f) => fs.existsSync(f));
  try {
    const base = process.env.BASE_REF || "origin/main";
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf-8",
    });
    return out
      .split("\n")
      .filter((f) =>
        /^sprints\/[^/]+\/(contract-draft|sprint-contract)\.md$/.test(f)
      )
      .filter((f) => fs.existsSync(f));
  } catch (e) {
    console.error(`${YELLOW}⚠️  git diff 失败${RESET}`);
    return [];
  }
}

/**
 * 从合同内容里提取 Test Contract 表的行
 * 表格式：| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
 * @returns {Array<{ws: string, testFile: string, behaviors: string[]}>}
 */
function parseTestContract(content) {
  const lines = content.split("\n");
  const rows = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##+\s*Test Contract/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##+\s/.test(line)) break; // 下一个 section 开始
    if (!inSection) continue;
    // 表格数据行：| WS1 | `tests/ws1/retry.test.ts` | ... | ... |
    const cells = line.split("|").map((s) => s.trim());
    if (cells.length < 5) continue;
    const ws = cells[1];
    const testFileRaw = cells[2];
    const behaviorsRaw = cells[3];
    if (!ws || !testFileRaw) continue;
    if (ws === "Workstream" || ws.startsWith("-")) continue; // 表头 / 分隔行
    // 取 backtick 里的路径
    const m = testFileRaw.match(/`([^`]+)`/);
    const testFile = m ? m[1] : testFileRaw;
    if (!/\.test\.ts$/.test(testFile)) continue;
    // behavior 覆盖用 '/' 分割
    const behaviors = behaviorsRaw
      .split(/[/,、]/)
      .map((s) => s.trim().replace(/^`|`$/g, ""))
      .filter((s) => s.length > 0);
    rows.push({ ws, testFile, behaviors });
  }
  return rows;
}

function checkContract(contractPath) {
  const sprintDir = path.dirname(contractPath);
  const content = fs.readFileSync(contractPath, "utf-8");
  const rows = parseTestContract(content);
  const violations = [];

  if (rows.length === 0) {
    return [
      `${contractPath}: 未找到 ## Test Contract 表或表为空（v5.0 合同必须含此表）`,
    ];
  }

  for (const row of rows) {
    // 测试文件路径：相对 sprint 目录
    const testFilePath = path.join(sprintDir, row.testFile);
    if (!fs.existsSync(testFilePath)) {
      violations.push(
        `${row.ws}: 声明的测试文件不存在 — ${testFilePath}`
      );
      continue;
    }
    const testContent = fs.readFileSync(testFilePath, "utf-8");
    const itMatches = [...testContent.matchAll(/\bit\(['"]([^'"]+)['"]/g)];
    const itNames = itMatches.map((m) => m[1]);
    if (itNames.length === 0) {
      violations.push(`${row.ws}: ${testFilePath} 无 it() 块`);
      continue;
    }
    // 每个声明的 behavior 必须能在 itNames 里找到（子串匹配）
    for (const behavior of row.behaviors) {
      const found = itNames.some(
        (n) =>
          n.toLowerCase().includes(behavior.toLowerCase()) ||
          behavior.toLowerCase().includes(n.toLowerCase())
      );
      if (!found) {
        violations.push(
          `${row.ws}: BEHAVIOR "${behavior}" 在 ${row.testFile} 的 ${itNames.length} 个 it() 中找不到对应项`
        );
      }
    }
  }

  return violations;
}

function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Test Coverage Check (v5.0 Test Contract)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const contracts = listContracts();
  if (contracts.length === 0) {
    console.log(
      `${YELLOW}ℹ️  无合同文件变更（contract-draft.md / sprint-contract.md），跳过${RESET}\n`
    );
    process.exit(0);
  }

  let total = 0;
  for (const c of contracts) {
    console.log(`📋 扫描合同: ${c}`);
    const vs = checkContract(c);
    if (vs.length === 0) {
      console.log(`  ${GREEN}✅ Test Contract 覆盖完整${RESET}\n`);
    } else {
      console.log(`  ${RED}❌ ${vs.length} 处违规${RESET}`);
      vs.forEach((v) => console.log(`    ${v}`));
      console.log("");
      total += vs.length;
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (total === 0) {
    console.log(
      `${GREEN}✅ Test Coverage 检查通过${RESET} (${contracts.length} 个合同)`
    );
    process.exit(0);
  } else {
    console.log(`${RED}❌ Test Coverage 检查失败${RESET} (${total} 处违规)`);
    console.log("\n  Test Contract 规则：");
    console.log("    - 合同含 ## Test Contract 表（v5.0 必须）");
    console.log("    - 每行声明的 Test File 必须在 PR 里存在");
    console.log("    - BEHAVIOR 覆盖项名必须在对应 .test.ts 有 it()");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    process.exit(1);
  }
}

main();
