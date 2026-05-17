#!/usr/bin/env node
/**
 * check-manual-cmd-whitelist.cjs
 *
 * 检测 Task Card 中 manual: 命令是否使用了 CI 白名单内的工具。
 * CI ubuntu-latest 只允许特定顶层命令，使用其他命令会导致 CI 失败。
 *
 * 使用方式：
 *   node packages/engine/scripts/devgate/check-manual-cmd-whitelist.cjs <task-card-path>
 *
 * 退出码：
 *   0 — 所有 manual: 命令均在白名单内，通过
 *   1 — 发现非白名单命令，blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 白名单定义
// ============================================================================

/**
 * CI ubuntu-latest 允许的顶层命令（manual: 后的第一个词）
 *
 * 原则：这些命令在 CI 环境中有完整运行时支持，可产生真实断言结果。
 * 其他命令（grep/ls/cat/find/sed/awk）在 CI 环境中可能行为不一致，
 * 且通常被用于无断言的输出型测试。
 */
const ALLOWED_COMMANDS = new Set(['node', 'npm', 'npx', 'curl', 'bash', 'psql', 'playwright']);

// ============================================================================
// 核心逻辑（导出供测试使用）
// ============================================================================

/**
 * 从 Test: manual:<cmd> 行中提取顶层命令名。
 * @param {string} line - Task Card 中的一行
 * @returns {string|null} 命令名，或 null（不是 manual: 行）
 */
function extractManualCommand(line) {
  // 匹配 "Test: manual:<cmd>" 格式（允许前导空格）
  const match = line.match(/Test:\s*manual:(\S+)/);
  if (!match) return null;

  // 提取第一个词（命令名），去掉参数
  // 例：node -e "..." → node
  //     npm run test → npm
  //     grep pattern file → grep
  const cmdWithArgs = match[1];
  return cmdWithArgs.split(/[\s/\\]/)[0].toLowerCase();
}

/**
 * 扫描 Task Card 内容，返回使用了非白名单命令的违规列表。
 * @param {string} content - Task Card 文件内容
 * @returns {{ lineNum: number, line: string, cmd: string }[]}
 */
function scanManualViolations(content) {
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const cmd = extractManualCommand(line);
    if (cmd === null) return; // 不是 manual: 行

    if (!ALLOWED_COMMANDS.has(cmd)) {
      violations.push({
        lineNum: idx + 1,
        line: line.trim(),
        cmd,
      });
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
  const violations = scanManualViolations(content);

  if (violations.length === 0) {
    process.stdout.write(`✅ manual: 命令白名单检查通过 — 所有命令均在白名单内（${taskCardPath}）\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ 发现 ${violations.length} 条非白名单 manual: 命令：\n`);
  process.stderr.write('\n');
  violations.forEach(({ lineNum, line, cmd }) => {
    process.stderr.write(`  第 ${lineNum} 行: manual:${cmd}（不在白名单内）\n`);
    process.stderr.write(`    ${line}\n`);
  });
  process.stderr.write('\n');
  process.stderr.write(`CI 白名单命令：${[...ALLOWED_COMMANDS].join(' / ')}\n`);
  process.stderr.write('\n');
  process.stderr.write('正确示例：\n');
  process.stderr.write('  Test: manual:node -e "const c=require(\'fs\').readFileSync(\'file\',\'utf8\');if(!c.includes(\'X\'))process.exit(1)"\n');
  process.stderr.write('  Test: manual:bash -c "node -e \'process.exit(0)\'"\n');
  process.stderr.write('  Test: manual:curl -sf http://localhost:5221/api/health | node -e "const d=JSON.parse(require(\'fs\').readFileSync(\'/dev/stdin\',\'utf8\'));if(!d.ok)process.exit(1)"\n');
  process.exit(1);
}

module.exports = { ALLOWED_COMMANDS, extractManualCommand, scanManualViolations };

if (require.main === module) {
  main(process.argv[2]);
}

