#!/usr/bin/env node
/**
 * light-evaluator.cjs
 *
 * 轻量 Evaluator — push 前自动真跑 [BEHAVIOR] DoD 断言
 *
 * 决策挂靠：145014a4③「改行为必有 evaluator 真跑复核」
 * task_id: 4950d174-cfcd-4a81-b078-0d695a78f103
 *
 * 用法：
 *   node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir <sprint-dir>
 *   node packages/engine/scripts/devgate/light-evaluator.cjs --sprint-dir <sprint-dir> --dry-run-no-behavior
 *
 * INV 约束：
 *   INV-01: 无 [BEHAVIOR] 条目必须豁免，exit 0
 *   INV-02: 不 spawn 独立 session，不调 judge，只原地真跑
 *   INV-04: 任一 exit_code ≠ 0 → exit 1（阻断 push）
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ─────────────────────────────────────────────────────────────────────────────
// CLI 参数解析
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

const sprintDir = getArg("--sprint-dir");
const dryRunNoBehavior = args.includes("--dry-run-no-behavior");

if (!sprintDir) {
  console.error("[light-evaluator] 错误: 缺少 --sprint-dir 参数");
  console.error("用法: node light-evaluator.cjs --sprint-dir <sprint-dir>");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[light-evaluator] ${msg}`);
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * 从 DoD 文件内容中提取所有 [BEHAVIOR] 条目的 Test 命令
 * 返回 [{id, cmd}]
 */
function extractBehaviorTests(content) {
  const entries = [];
  const lines = content.split("\n");

  let currentId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 同时接受历史标题格式与 check-dod-mapping 使用的 checklist 格式。
    const behaviorMatch = line.match(
      /^\s*(?:###\s+|-\s+\[[ xX]\]\s+)\[BEHAVIOR\]\s+(?:\[L\d+\]\s+)?([\w-]+)/,
    );
    if (behaviorMatch) {
      currentId = behaviorMatch[1];
      continue;
    }

    // Test 行允许缩进、单/双引号 bash -c，也允许 node 等直接命令。
    if (currentId) {
      const testMatch = line.match(/^\s*Test:\s+manual:(.+?)\s*$/);
      if (testMatch) {
        const rawCommand = testMatch[1].trim();
        const bashCommand = rawCommand.match(/^bash\s+-c\s+(['"])([\s\S]*)\1$/);
        entries.push({
          id: currentId,
          cmd: bashCommand ? bashCommand[2] : rawCommand,
        });
        currentId = null;
        continue;
      }

      // 新 section/checklist 开始仍未出现 Test 时，当前条目无可执行断言。
      if (/^\s*(?:###\s+|-\s+\[[ xX]\]\s+)/.test(line)) {
        currentId = null;
      }
    }
  }

  return entries;
}

/**
 * 执行单条命令，返回 {exit_code, output, tail5}
 */
function runCmd(cmd, timeoutMs) {
  timeoutMs = timeoutMs || 60000;
  // cmd 来自合同 DoD 的 Test: manual:bash -c "..." 内部——设计上是在 bash double-quote
  // 上下文里的字符串，所以 \\ → \，\" → "（shell double-quote unescape 一层）
  const unescaped = cmd.replace(/\\\\/g, "\\").replace(/\\"/g, '"');

  const result = spawnSync("bash", ["-c", unescaped], {
    encoding: "utf-8",
    timeout: timeoutMs,
  });

  const exitCode = result.status !== null ? result.status : 1;
  const output = (result.stdout || "") + (result.stderr || "");
  const lines = output.split("\n").filter((l) => l !== "");
  const tail5 = lines.slice(-5);

  return { exit_code: exitCode, output, tail5 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const resolvedSprintDir = path.resolve(sprintDir);
  log(`扫描 sprint 目录: ${resolvedSprintDir}`);

  // 检查 sprint 目录是否存在
  if (!fs.existsSync(resolvedSprintDir)) {
    log(`警告: sprint 目录不存在: ${resolvedSprintDir}`);
    // 豁免
    writeSkipped(resolvedSprintDir, [], "sprint directory not found");
    log("exit 0（目录不存在，豁免）");
    process.exit(0);
  }

  // 扫描 DoD 文件（contract-dod*.md 或任何 .md 文件）
  let dodFiles = [];
  try {
    const allFiles = fs.readdirSync(resolvedSprintDir);
    dodFiles = allFiles
      .filter((f) => f.endsWith(".md") && (f.includes("contract-dod") || f.includes("dod")))
      .map((f) => path.join(resolvedSprintDir, f));

    // 如果没有 dod 文件，扫描所有 .md 文件
    if (dodFiles.length === 0) {
      dodFiles = allFiles
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.join(resolvedSprintDir, f));
    }
  } catch (e) {
    log(`扫描目录失败: ${e.message}`);
    writeSkipped(resolvedSprintDir, [], "scan error: " + e.message);
    process.exit(0);
  }

  log(`发现 ${dodFiles.length} 个 DoD 文件`);

  // 提取所有 [BEHAVIOR] 测试条目
  let allEntries = [];
  const scannedFiles = [];

  for (const dodFile of dodFiles) {
    const fname = path.basename(dodFile);
    scannedFiles.push(fname);
    try {
      const content = fs.readFileSync(dodFile, "utf-8");
      const entries = extractBehaviorTests(content);
      allEntries = allEntries.concat(entries);
    } catch (e) {
      log(`读取文件失败: ${fname} — ${e.message}`);
    }
  }

  // 豁免条件：无 [BEHAVIOR] 条目 或 --dry-run-no-behavior 模式
  if (allEntries.length === 0 || dryRunNoBehavior) {
    if (dryRunNoBehavior && allEntries.length > 0) {
      log("--dry-run-no-behavior 模式：强制豁免（忽略已发现的 BEHAVIOR 条目）");
    } else {
      log("未发现 [BEHAVIOR] 条目 → skipped（豁免）");
    }
    writeSkipped(resolvedSprintDir, scannedFiles, "no [BEHAVIOR] entries");
    log(`写 verify-record.json → ${resolvedSprintDir}/verify-record.json`);
    log("exit 0");
    process.exit(0);
  }

  log(`发现 ${allEntries.length} 条 [BEHAVIOR] 条目，开始逐条真执行`);

  // 逐条执行
  const resultEntries = [];
  let hasFailure = false;

  for (const entry of allEntries) {
    log(`  ${entry.id} 执行: ${entry.cmd.slice(0, 80)}...`);
    const result = runCmd(entry.cmd);

    const status = result.exit_code === 0 ? "PASS" : "FAIL";
    log(`  ${entry.id} → ${status} (exit_code=${result.exit_code})`);

    if (result.exit_code !== 0) {
      hasFailure = true;
      log(`  ${entry.id} 尾5行输出:`);
      result.tail5.forEach((l) => log(`    ${l}`));
    }

    resultEntries.push({
      id: entry.id,
      cmd: entry.cmd,
      exit_code: result.exit_code,
      tail5: result.tail5,
      timestamp: isoNow(),
    });
  }

  // 写 verify-record.json
  const record = {
    sprint_dir: resolvedSprintDir,
    timestamp: isoNow(),
    overall: hasFailure ? "FAIL" : "PASS",
    entries: resultEntries,
  };

  const recordPath = path.join(resolvedSprintDir, "verify-record.json");
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf-8");
  log(`写 verify-record.json → ${recordPath}`);

  if (hasFailure) {
    log("有失败条目 → push 被阻断");
    log("exit 1");
    process.exit(1);
  } else {
    log("全部通过 → exit 0");
    process.exit(0);
  }
}

function writeSkipped(sprintDir, files, reason) {
  const record = {
    skipped: true,
    reason: reason || "no [BEHAVIOR] entries",
    files: files,
    timestamp: isoNow(),
  };

  try {
    const recordPath = path.join(sprintDir, "verify-record.json");
    fs.writeFileSync(recordPath, JSON.stringify(record, null, 2), "utf-8");
  } catch (e) {
    log(`写 verify-record.json 失败: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 入口（支持直接 require 不抛 Error）
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  main();
}

module.exports = { extractBehaviorTests, runCmd };
