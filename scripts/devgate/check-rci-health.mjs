#!/usr/bin/env node
/**
 * check-rci-health.mjs
 *
 * RCI 健康检查：确保每条 P0 契约都是"活的"（有真实测试，文件存在）。
 *
 * 检查规则：
 *   1. P0 条目必须有 test 字段（且不为空）
 *   2. test 字段指向的文件必须存在（反向孤儿检测）
 *   3. evidence.file 指向的文件必须存在（源文件孤儿检测）
 *   4. deprecated: true 的条目自动跳过
 *
 * 用法：
 *   node scripts/devgate/check-rci-health.mjs
 *   node scripts/devgate/check-rci-health.mjs --dry-run
 *   node scripts/devgate/check-rci-health.mjs --contract packages/engine/regression-contract.yaml
 *
 * 退出码：
 *   0 - 通过
 *   1 - 有 P0 空头契约或孤儿条目
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

// ─── 参数解析 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const contractArg = args.find((a) => a.startsWith("--contract="))?.split("=")[1];
const contractArgLong = args[args.indexOf("--contract") + 1];
const CONTRACT_PATH = contractArg || contractArgLong || join(ROOT, "packages/engine/regression-contract.yaml");

// ─── 简单 YAML 解析（提取 RCI 条目）──────────────────────────────────────────
function parseRciEntries(content) {
  const entries = [];
  // 按条目分割（以 "  - id:" 开头）
  const blocks = content.split(/\n(?=  - id:)/);

  for (const block of blocks) {
    const idMatch = block.match(/^\s*-?\s*id:\s*(.+)$/m);
    const priorityMatch = block.match(/^\s*priority:\s*(.+)$/m);
    const testMatch = block.match(/^\s*test:\s*(.+)$/m);
    const testFileMatch = block.match(/^\s*test_file:\s*(.+)$/m);
    const testCmdMatch = block.match(/^\s*test_command:\s*(.+)$/m);
    const evidenceFileMatch = block.match(/^\s*file:\s*"?([^"\n]+)"?$/m);
    const deprecatedMatch = block.match(/^\s*deprecated:\s*true/m);
    const nameMatch = block.match(/^\s*name:\s*"?([^"\n]+)"?$/m);

    if (!idMatch) continue;

    entries.push({
      id: idMatch[1].trim(),
      name: nameMatch ? nameMatch[1].trim() : "",
      priority: priorityMatch ? priorityMatch[1].trim() : "",
      test: testMatch ? testMatch[1].trim() : null,
      testFile: testFileMatch ? testFileMatch[1].trim() : null,
      testCommand: testCmdMatch ? testCmdMatch[1].trim() : null,
      evidenceFile: evidenceFileMatch ? evidenceFileMatch[1].trim() : null,
      deprecated: !!deprecatedMatch,
    });
  }
  return entries;
}

// ─── 检查文件是否存在（相对合约所在目录的 package 根）────────────────────────
function checkFileExists(relPath, packageRoot) {
  if (!relPath) return true; // 没有路径则跳过
  // 跳过非文件引用（yq 命令、URL 等）
  if (relPath.startsWith("yq ") || relPath.startsWith("bash ") || relPath.startsWith("node ")) return true;
  return existsSync(join(packageRoot, relPath));
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────
function run() {
  if (!existsSync(CONTRACT_PATH)) {
    console.log(`${YELLOW}WARNING: Contract file not found: ${CONTRACT_PATH}${RESET}`);
    console.log("  Skipping RCI health check");
    process.exit(0);
  }

  // 确定 package 根目录（contract 文件所在目录）
  const packageRoot = dirname(CONTRACT_PATH);

  const content = readFileSync(CONTRACT_PATH, "utf-8");
  const entries = parseRciEntries(content);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  RCI Health Check");
  console.log(`  Contract: ${CONTRACT_PATH.replace(ROOT + "/", "")}`);
  console.log(`  条目总数: ${entries.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  let p0NoTest = [];
  let orphanEvidence = [];
  let orphanTest = [];
  let passed = 0;
  let skipped = 0;

  for (const entry of entries) {
    const { id, name, priority, test, testFile, evidenceFile, deprecated } = entry;

    // deprecated 条目跳过
    if (deprecated) {
      skipped++;
      continue;
    }

    // 检查1：P0 必须有 test 字段
    if (priority === "P0" && !test && !testFile) {
      p0NoTest.push({ id, name, priority });
      continue;
    }

    // 检查2：evidence.file 存在性（孤儿检测）
    if (evidenceFile && !checkFileExists(evidenceFile, packageRoot)) {
      orphanEvidence.push({ id, name, evidenceFile });
    }

    // 检查3：test 字段指向的文件存在性
    const testPath = test || testFile;
    if (
      testPath &&
      !testPath.startsWith("bash ") &&
      !testPath.startsWith("node ") &&
      !testPath.startsWith("yq ") &&
      !checkFileExists(testPath, packageRoot)
    ) {
      orphanTest.push({ id, name, testPath });
    } else {
      passed++;
    }
  }

  // ─── 输出报告 ──────────────────────────────────────────────────────────────
  if (p0NoTest.length > 0) {
    console.log(`${RED}❌ P0 空头契约（有 priority: P0 但无 test 字段）：${RESET}`);
    for (const { id, name } of p0NoTest) {
      console.log(`   ${id}: ${name}`);
    }
    console.log();
  }

  if (orphanEvidence.length > 0) {
    console.log(`${YELLOW}⚠️  孤儿 evidence（evidence.file 指向不存在的文件）：${RESET}`);
    for (const { id, name, evidenceFile } of orphanEvidence) {
      console.log(`   ${id}: ${name}`);
      console.log(`      evidence.file: ${evidenceFile} → 不存在`);
    }
    console.log();
  }

  if (orphanTest.length > 0) {
    console.log(`${YELLOW}⚠️  孤儿测试引用（test 文件不存在）：${RESET}`);
    for (const { id, name, testPath } of orphanTest) {
      console.log(`   ${id}: ${name}`);
      console.log(`      test: ${testPath} → 文件不存在`);
    }
    console.log();
  }

  const totalIssues = p0NoTest.length + orphanEvidence.length + orphanTest.length;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  通过: ${passed} | P0空头: ${p0NoTest.length} | 孤儿evidence: ${orphanEvidence.length} | 孤儿test: ${orphanTest.length} | 跳过(deprecated): ${skipped}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // P0 空头契约是硬失败；孤儿是警告（不阻塞，但输出明显）
  const hardFailures = p0NoTest.length;

  if (hardFailures > 0) {
    console.log();
    console.log(`${RED}  RCI Health Check FAILED${RESET}`);
    console.log(`  ${hardFailures} 个 P0 契约没有测试 — 必须修复后才能合并`);
    console.log();
    console.log("  修复方式：");
    console.log("    1. 为 P0 契约添加真实 test 字段（指向测试文件路径）");
    console.log("    2. 或将优先级降为 P1（需说明理由）");
    console.log("    3. 或标记 deprecated: true（功能已废弃）");
    console.log();

    if (!DRY_RUN) {
      process.exit(1);
    } else {
      console.log(`  ${YELLOW}（dry-run 模式：仅报告，不失败）${RESET}`);
    }
  } else if (totalIssues > 0) {
    console.log();
    console.log(`${YELLOW}  RCI Health Check PASSED（有警告）${RESET}`);
    console.log("  孤儿条目不阻塞合并，但建议清理");
  } else {
    console.log();
    console.log(`${GREEN}  RCI Health Check PASSED${RESET}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  }
}

run();
