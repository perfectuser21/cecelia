#!/usr/bin/env node
/**
 * check-manual-cmd-whitelist.cjs
 *
 * 检测 Task Card 中 manual: 前缀命令是否使用了白名单外的工具。
 * 被 verify-step.sh step1 和 CI L1 manual-cmd-whitelist-check job 共同调用。
 *
 * 使用方式：
 *   node packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs <task-card-path>
 *
 * 退出码：
 *   0 — 全部合规，通过
 *   1 — 发现非白名单命令，blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 白名单定义
// ============================================================================

/**
 * CI 允许的 manual: 命令前缀（第一个词）。
 * 与 MEMORY.md 中记录的规范一致：node/npm/curl/bash/psql。
 */
const ALLOWED_TOOLS = ['node', 'npm', 'curl', 'bash', 'psql'];

// ============================================================================
// 核心逻辑（导出供测试使用）
// ============================================================================

/**
 * 扫描 Task Card 内容，返回 manual: 白名单违规列表。
 *
 * @param {string} content - Task Card 文件内容
 * @returns {{ lineNum: number, line: string, tool: string }[]}
 */
function scanManualCmdViolations(content) {
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    // 匹配 Test: manual:<cmd> 形式（允许前置空格）
    const match = line.match(/^\s+Test:\s+manual:(\S+)/);
    if (!match) return;

    // 提取命令的第一个词（工具名）
    const cmdPart = match[1];
    // 支持 manual:node、manual:bash -c 等形式
    const tool = cmdPart.split(/[\s-]/)[0].toLowerCase();

    if (!ALLOWED_TOOLS.includes(tool)) {
      violations.push({ lineNum, line: line.trim(), tool });
    }
  });

  return violations;
}

// ============================================================================
// CLI 入口
// ============================================================================

function main(taskCardPath) {
  if (!taskCardPath) {
    process.stderr.write('用法: node check-manual-cmd-whitelist.cjs <task-card-path>\n');
    process.exit(1);
  }

  const absPath = path.resolve(process.cwd(), taskCardPath);

  if (!fs.existsSync(absPath)) {
    process.stderr.write(`❌ Task Card 文件不存在: ${absPath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const violations = scanManualCmdViolations(content);

  if (violations.length === 0) {
    process.stdout.write(`✅ manual: 命令白名单检查通过 — 未发现非白名单命令（${taskCardPath}）\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ 发现 ${violations.length} 条 manual: 命令使用了非白名单工具：\n`);
  process.stderr.write('\n');
  violations.forEach(({ lineNum, line, tool }) => {
    process.stderr.write(`  第 ${lineNum} 行: 工具 "${tool}" 不在白名单\n`);
    process.stderr.write(`    ${line}\n`);
  });
  process.stderr.write('\n');
  process.stderr.write(`CI 白名单仅允许：${ALLOWED_TOOLS.join(' / ')}\n`);
  process.stderr.write('\n');
  process.stderr.write('修复方法：将非白名单命令改写为 node -e 形式，例如：\n');
  process.stderr.write('  ❌ Test: manual:grep -c "pattern" file\n');
  process.stderr.write('  ✅ Test: manual:node -e "const c=require(\'fs\').readFileSync(\'file\',\'utf8\');if(!c.includes(\'pattern\'))process.exit(1)"\n');
  process.stderr.write('  ❌ Test: manual:ls packages/engine/scripts/\n');
  process.stderr.write('  ✅ Test: manual:node -e "require(\'fs\').accessSync(\'packages/engine/scripts/check.cjs\')"\n');
  process.exit(1);
}

module.exports = { ALLOWED_TOOLS, scanManualCmdViolations };

if (require.main === module) {
  main(process.argv[2]);
}
