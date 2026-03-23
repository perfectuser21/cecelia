#!/usr/bin/env node
/**
 * check-fake-dod-tests.cjs
 *
 * 检测 Task Card 中的假 DoD Test 命令（无真实断言的伪测试）。
 * 被 verify-step.sh 和 CI L1 fake-dod-test-check job 共同调用。
 *
 * 使用方式：
 *   node packages/engine/scripts/devgate/check-fake-dod-tests.cjs <task-card-path>
 *
 * 退出码：
 *   0 — 没有假测试，通过
 *   1 — 发现假测试，blocked
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 假测试模式定义
// ============================================================================

/**
 * 假测试命令模式（正则，匹配 Test: 行中的命令部分）
 *
 * 原则：这些命令只"输出"或"检查存在"，没有真实断言失败路径。
 *
 * 允许的真实测试：
 *   manual:node -e "...if(!c.includes('X'))process.exit(1)"
 *   manual:bash -c "..."（需包含 exit 1 或 assert）
 *   tests/path/to/test.ts
 *   contract:behavior-id
 */
const FAKE_PATTERNS = [
  // echo 系：直接输出字符串，无断言
  { pattern: /Test:\s*(manual:)?\s*echo\s/, desc: 'echo（无断言，只输出）' },
  { pattern: /Test:\s*(manual:)?\s*printf\s/, desc: 'printf（无断言，只输出）' },

  // ls/cat：列文件或读文件内容，不验证
  { pattern: /Test:\s*(manual:)?\s*ls(\s|$)/, desc: 'ls（只列目录，不验证内容）' },
  { pattern: /Test:\s*(manual:)?\s*cat\s/, desc: 'cat（只读文件，无断言）' },

  // 布尔假值：永远成功
  { pattern: /Test:\s*(manual:)?\s*true\s*$/, desc: 'true（永远成功，无意义）' },
  { pattern: /Test:\s*(manual:)?\s*exit\s+0\s*$/, desc: 'exit 0（永远成功，无意义）' },
  { pattern: /Test:\s*(manual:)?\s*test\s+-f\s/, desc: 'test -f（只检查文件存在，不验证内容）' },

  // grep | wc 系：计数而不断言
  { pattern: /Test:.*grep[^|]*\|[^|]*wc/, desc: 'grep | wc（计数不断言，应用 grep -c 或 process.exit）' },
  { pattern: /Test:.*\|\s*wc\s+-l/, desc: '| wc -l（计数不断言，需要明确比较）' },

  // 单纯 wc：无断言
  { pattern: /Test:\s*(manual:)?\s*wc\s/, desc: 'wc（计数无断言）' },
];

// ============================================================================
// 核心逻辑（导出供测试使用）
// ============================================================================

/**
 * 扫描 Task Card 内容，返回违规列表。
 * @param {string} content - Task Card 文件内容
 * @returns {{ lineNum: number, line: string, desc: string }[]}
 */
function scanViolations(content) {
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    for (const { pattern, desc } of FAKE_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({ lineNum, line: line.trim(), desc });
        break; // 一行只报一次
      }
    }
  });

  return violations;
}

// ============================================================================
// CLI 入口
// ============================================================================

function main(taskCardPath) {
  if (!taskCardPath) {
    process.stderr.write('用法: node check-fake-dod-tests.cjs <task-card-path>\n');
    process.exit(1);
  }

  const absPath = path.resolve(process.cwd(), taskCardPath);

  if (!fs.existsSync(absPath)) {
    process.stderr.write(`❌ Task Card 文件不存在: ${absPath}\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(absPath, 'utf8');
  const violations = scanViolations(content);

  if (violations.length === 0) {
    process.stdout.write(`✅ 假 DoD Test 检测通过 — 未发现假测试模式（${taskCardPath}）\n`);
    process.exit(0);
  }

  process.stderr.write(`❌ 发现 ${violations.length} 条假 DoD Test（无真实断言）：\n`);
  process.stderr.write('\n');
  violations.forEach(({ lineNum, line, desc }) => {
    process.stderr.write(`  第 ${lineNum} 行: ${desc}\n`);
    process.stderr.write(`    ${line}\n`);
  });
  process.stderr.write('\n');
  process.stderr.write('禁止的假测试模式：\n');
  process.stderr.write('  echo / printf / ls / cat — 只输出，无断言\n');
  process.stderr.write('  true / exit 0 — 永远成功\n');
  process.stderr.write('  grep | wc / wc -l — 计数但不断言结果\n');
  process.stderr.write('\n');
  process.stderr.write('正确示例：\n');
  process.stderr.write('  Test: manual:node -e "const c=require(\'fs\').readFileSync(\'file\',\'utf8\');if(!c.includes(\'X\'))process.exit(1)"\n');
  process.stderr.write('  Test: tests/my.test.ts\n');
  process.stderr.write('  Test: contract:my-behavior\n');
  process.exit(1);
}

module.exports = { FAKE_PATTERNS, scanViolations };

if (require.main === module) {
  main(process.argv[2]);
}
